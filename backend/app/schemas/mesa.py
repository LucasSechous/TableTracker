# Schemas Pydantic para validación y serialización de mesas.
# MesaResponse incluye el sector anidado (id + nombre).

from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.models.mesa import EstadoMesa


class SectorAnidado(BaseModel):
    id: int
    nombre: str

    model_config = {"from_attributes": True}


class MesaCreate(BaseModel):
    numero: int
    sector_id: int
    estado: EstadoMesa = EstadoMesa.libre
    activa: bool = True


class MesaUpdate(BaseModel):
    numero: Optional[int] = None
    sector_id: Optional[int] = None
    estado: Optional[EstadoMesa] = None
    activa: Optional[bool] = None


class MesaResponse(BaseModel):
    id: int
    numero: int
    sector_id: int
    sector: SectorAnidado
    estado: EstadoMesa
    activa: bool
    created_at: datetime

    model_config = {"from_attributes": True}
