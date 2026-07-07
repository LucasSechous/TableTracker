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
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    ancho: Optional[int] = None
    alto: Optional[int] = None


class SectorResponse(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str]
    activo: bool
    pos_x: int = 0
    pos_y: int = 0
    ancho: int = 400
    alto: int = 300

    model_config = {"from_attributes": True}
