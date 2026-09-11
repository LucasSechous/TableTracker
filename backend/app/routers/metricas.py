# Métricas agregadas para el panel de RF-22.
# GET /metricas/ocupacion: % de ocupación del salón y conteo de mesas por
# estado, calculado en el momento a partir de mesas (sin tabla ni modelo
# propio: es una consulta agregada, no un dato persistente).

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.configuracion import ConfiguracionGeneral
from app.models.historial import HistorialEstado
from app.models.mesa import EstadoMesa, Mesa
from app.models.sector import Sector
from app.routers.auth import get_usuario_actual
from app.schemas.metricas import (
    ConteoPorEstado,
    OcupacionDiariaMesaResponse,
    OcupacionDiariaResponse,
    OcupacionResponse,
    RotacionMesaResponse,
    TiempoPorEstado,
)
from app.services.horario import en_horario_de_servicio, hoy_local, rango_dia_operativo
from app.services.ocupacion import calcular_ocupacion_por_mesa

router = APIRouter(dependencies=[Depends(get_usuario_actual)])

# Decisión (T26-154, impacta la lectura del panel de RF-22): "reservada" NO
# cuenta como ocupación para el % general. Una mesa reservada todavía está
# físicamente libre (nadie sentado, nadie consumiendo), así que sumarla al %
# de ocupación sobreestimaría cuánto salón está realmente en uso. Se sigue
# devolviendo como bucket aparte en conteo_por_estado para que el panel pueda
# mostrarla sin mezclarla con el %.
ESTADOS_QUE_CUENTAN_COMO_OCUPACION = {EstadoMesa.ocupada}


@router.get("/ocupacion", response_model=OcupacionResponse)
def obtener_ocupacion(sector_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    if sector_id is not None and not db.query(Sector).filter(Sector.id == sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")

    query = db.query(Mesa.estado, func.count(Mesa.id)).filter(Mesa.activa == True)  # noqa: E712
    if sector_id is not None:
        query = query.filter(Mesa.sector_id == sector_id)
    filas = query.group_by(Mesa.estado).all()

    conteo = ConteoPorEstado()
    total_mesas = 0
    ocupadas = 0
    for estado, cantidad in filas:
        setattr(conteo, estado.value, cantidad)
        total_mesas += cantidad
        if estado in ESTADOS_QUE_CUENTAN_COMO_OCUPACION:
            ocupadas += cantidad

    porcentaje_ocupacion = round((ocupadas / total_mesas) * 100, 2) if total_mesas > 0 else 0.0

    return OcupacionResponse(
        total_mesas=total_mesas,
        porcentaje_ocupacion=porcentaje_ocupacion,
        conteo_por_estado=conteo,
    )


# Decisión (T26-155): una "rotación" es una transición de estado hacia 'ocupada'
# desde un estado distinto (libre/pendiente_limpieza/reservada -> ocupada), no una
# fila cruda de historial_estados con estado='ocupada'. Dos correcciones manuales
# seguidas a 'ocupada' (ej. por un error de detección) son una sola rotación, no
# dos, porque entre ellas el estado anterior sigue siendo 'ocupada'.
#
# Caso de borde: si el rango [fecha_inicio, fecha_fin] arranca en medio de una
# ocupación que ya venía de antes del rango, la primera fila 'ocupada' dentro del
# rango NO debe contar — la mesa no "rotó" al entrar al rango, ya estaba ocupada.
# Por eso se resuelve el estado de cada mesa justo antes de fecha_inicio (última
# fila con created_at < fecha_inicio) antes de contar transiciones dentro del
# rango. Si una mesa no tiene ninguna fila anterior a fecha_inicio, se asume
# 'libre' (el default de Mesa.estado en el alta), así que su primera fila
# 'ocupada' de siempre sí cuenta como rotación real.
@router.get("/rotacion", response_model=list[RotacionMesaResponse])
def obtener_rotacion(
    fecha_inicio: Optional[datetime] = Query(None),
    fecha_fin: Optional[datetime] = Query(None),
    sector_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    if fecha_inicio is not None and fecha_fin is not None and fecha_inicio > fecha_fin:
        raise HTTPException(status_code=400, detail="fecha_inicio no puede ser posterior a fecha_fin")
    if sector_id is not None and not db.query(Sector).filter(Sector.id == sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")

    mesas_query = db.query(Mesa).filter(Mesa.activa == True)  # noqa: E712
    if sector_id is not None:
        mesas_query = mesas_query.filter(Mesa.sector_id == sector_id)
    mesas = mesas_query.all()
    mesa_ids = [mesa.id for mesa in mesas]

    estado_previo: dict[int, EstadoMesa] = {mesa_id: EstadoMesa.libre for mesa_id in mesa_ids}
    if fecha_inicio is not None and mesa_ids:
        corte = (
            db.query(
                HistorialEstado.mesa_id.label("mesa_id"),
                func.max(HistorialEstado.created_at).label("corte"),
            )
            .filter(HistorialEstado.mesa_id.in_(mesa_ids), HistorialEstado.created_at < fecha_inicio)
            .group_by(HistorialEstado.mesa_id)
            .subquery()
        )
        filas_previas = db.query(HistorialEstado.mesa_id, HistorialEstado.estado).join(
            corte,
            and_(HistorialEstado.mesa_id == corte.c.mesa_id, HistorialEstado.created_at == corte.c.corte),
        )
        for mesa_id, estado in filas_previas:
            estado_previo[mesa_id] = estado

    rotaciones: dict[int, int] = {mesa_id: 0 for mesa_id in mesa_ids}
    if mesa_ids:
        query_rango = db.query(HistorialEstado).filter(HistorialEstado.mesa_id.in_(mesa_ids))
        if fecha_inicio is not None:
            query_rango = query_rango.filter(HistorialEstado.created_at >= fecha_inicio)
        if fecha_fin is not None:
            query_rango = query_rango.filter(HistorialEstado.created_at <= fecha_fin)
        filas = query_rango.order_by(HistorialEstado.mesa_id, HistorialEstado.created_at).all()

        # Horario de servicio (T26-171). Con las horas sin cargar, en_horario_de_servicio()
        # devuelve True siempre y el conteo queda idéntico al de antes del ticket.
        config = db.query(ConfiguracionGeneral).filter(ConfiguracionGeneral.id == 1).first()
        apertura = config.hora_apertura if config else None
        cierre = config.hora_cierre if config else None

        for fila in filas:
            anterior = estado_previo[fila.mesa_id]
            es_rotacion = fila.estado == EstadoMesa.ocupada and anterior != EstadoMesa.ocupada
            if es_rotacion and en_horario_de_servicio(fila.created_at, apertura, cierre):
                rotaciones[fila.mesa_id] += 1
            # El arrastre del estado se actualiza SIEMPRE, esté la fila dentro de la franja
            # o no. Saltear las filas de fuera del horario rompería el conteo: una mesa que
            # se ocupó a las 3 de la mañana seguiría figurando como libre, y su próxima
            # transición a 'ocupada' —esa sí en horario— se contaría como una rotación que
            # no ocurrió. Lo que se recorta es qué transiciones CUENTAN, no cuáles se ven.
            estado_previo[fila.mesa_id] = fila.estado

    return [
        RotacionMesaResponse(
            mesa_id=mesa.id,
            numero=mesa.numero,
            sector_id=mesa.sector_id,
            rotaciones=rotaciones[mesa.id],
        )
        for mesa in mesas
    ]


# Resumen diario de ocupación (T26-185, RF-32): a diferencia de /ocupacion (foto del
# instante) y /rotacion (conteo de transiciones), acá se reconstruye cuánto tiempo estuvo
# cada mesa en cada estado durante el "día operativo" de `fecha` — ver rango_dia_operativo
# en app/services/horario.py para la decisión de dónde se corta ese día.
#
# Sin filtro de Mesa.activa en la query: a diferencia de /ocupacion y /rotacion, una mesa
# hoy inactiva puede haber estado activa durante el día pedido y sí debe poder aparecer. Es
# calcular_ocupacion_por_mesa quien decide, mesa por mesa, si hay datos suficientes para
# incluirla (ver app/services/ocupacion.py).
@router.get("/ocupacion-diaria", response_model=OcupacionDiariaResponse)
def obtener_ocupacion_diaria(
    fecha: Optional[date] = Query(None), sector_id: Optional[int] = Query(None), db: Session = Depends(get_db)
):
    if sector_id is not None and not db.query(Sector).filter(Sector.id == sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")

    if fecha is None:
        fecha = hoy_local()

    config = db.query(ConfiguracionGeneral).filter(ConfiguracionGeneral.id == 1).first()
    apertura = config.hora_apertura if config else None
    cierre = config.hora_cierre if config else None
    inicio, fin = rango_dia_operativo(fecha, apertura, cierre)

    mesas_query = db.query(Mesa)
    if sector_id is not None:
        mesas_query = mesas_query.filter(Mesa.sector_id == sector_id)
    mesas = mesas_query.all()

    minutos_por_mesa = calcular_ocupacion_por_mesa(db, mesas, inicio, fin)

    mesas_respuesta = []
    total_minutos = {estado.value: 0.0 for estado in EstadoMesa}
    ocupada_total = 0.0
    ventana_total = 0.0

    for mesa in mesas:
        tiempos = minutos_por_mesa.get(mesa.id)
        if tiempos is None:
            continue

        duracion_mesa = sum(tiempos.values())
        ocupada_mesa = sum(tiempos[estado.value] for estado in ESTADOS_QUE_CUENTAN_COMO_OCUPACION)
        porcentaje_mesa = round((ocupada_mesa / duracion_mesa) * 100, 2) if duracion_mesa > 0 else 0.0

        mesas_respuesta.append(
            OcupacionDiariaMesaResponse(
                mesa_id=mesa.id,
                numero=mesa.numero,
                sector_id=mesa.sector_id,
                minutos_por_estado=TiempoPorEstado(**tiempos),
                porcentaje_ocupacion=porcentaje_mesa,
            )
        )
        for estado_valor, minutos in tiempos.items():
            total_minutos[estado_valor] += minutos
        ventana_total += duracion_mesa
        ocupada_total += ocupada_mesa

    porcentaje_general = round((ocupada_total / ventana_total) * 100, 2) if ventana_total > 0 else 0.0
    fin_efectivo = min(fin, datetime.now(timezone.utc))

    return OcupacionDiariaResponse(
        fecha=fecha,
        inicio=inicio,
        fin=fin_efectivo,
        total_mesas=len(mesas_respuesta),
        porcentaje_ocupacion=porcentaje_general,
        minutos_por_estado=TiempoPorEstado(**total_minutos),
        mesas=mesas_respuesta,
    )
