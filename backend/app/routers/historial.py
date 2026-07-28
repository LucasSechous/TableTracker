# Router para consultar el historial de cambios de estado de las mesas.
# Expone el listado con filtros opcionales por mesa y rango de fechas.

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Literal, Optional
from datetime import datetime
from app.database import get_db
from app.models.historial import HistorialEstado
from app.schemas.historial import HistorialEstadoResponse
from app.routers.auth import get_usuario_actual

router = APIRouter(dependencies=[Depends(get_usuario_actual)])


@router.get("/", response_model=list[HistorialEstadoResponse])
def listar_historial(
    mesa_id: Optional[int] = Query(None),
    fecha_inicio: Optional[datetime] = Query(None),
    fecha_fin: Optional[datetime] = Query(None),
    orden: Literal["asc", "desc"] = Query("desc"),
    db: Session = Depends(get_db),
):
    if fecha_inicio is not None and fecha_fin is not None and fecha_inicio > fecha_fin:
        raise HTTPException(status_code=400, detail="fecha_inicio no puede ser posterior a fecha_fin")
    query = db.query(HistorialEstado)
    if mesa_id is not None:
        query = query.filter(HistorialEstado.mesa_id == mesa_id)
    if fecha_inicio is not None:
        query = query.filter(HistorialEstado.created_at >= fecha_inicio)
    if fecha_fin is not None:
        query = query.filter(HistorialEstado.created_at <= fecha_fin)
    orden_columna = HistorialEstado.created_at.asc() if orden == "asc" else HistorialEstado.created_at.desc()
    return query.order_by(orden_columna).all()
