# Métricas agregadas para el panel de RF-22.
# GET /metricas/ocupacion: % de ocupación del salón y conteo de mesas por
# estado, calculado en el momento a partir de mesas (sin tabla ni modelo
# propio: es una consulta agregada, no un dato persistente).

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.historial import HistorialEstado
from app.models.mesa import EstadoMesa, Mesa
from app.models.sector import Sector
from app.routers.auth import get_usuario_actual
from app.schemas.metricas import ConteoPorEstado, OcupacionResponse, RotacionMesaResponse

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

        for fila in filas:
            anterior = estado_previo[fila.mesa_id]
            if fila.estado == EstadoMesa.ocupada and anterior != EstadoMesa.ocupada:
                rotaciones[fila.mesa_id] += 1
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
