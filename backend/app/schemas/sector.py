from pydantic import BaseModel
from typing import Optional


class SectorCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    activo: bool = True


class SectorUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    activo: Optional[bool] = None


class SectorResponse(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str]
    activo: bool

    model_config = {"from_attributes": True}
