# Métricas agregadas para el panel de RF-22.
# GET /metricas/ocupacion: % de ocupación del salón y conteo de mesas por
# estado, calculado en el momento a partir de mesas (sin tabla ni modelo
# propio: es una consulta agregada, no un dato persistente).

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.mesa import EstadoMesa, Mesa
from app.models.sector import Sector
from app.routers.auth import get_usuario_actual
from app.schemas.metricas import ConteoPorEstado, OcupacionResponse

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
