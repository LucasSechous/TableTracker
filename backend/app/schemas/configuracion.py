from pydantic import BaseModel, Field
from typing import Optional


class ConfiguracionResponse(BaseModel):
    ancho_salon: int
    alto_salon: int
    nombre_establecimiento: Optional[str]

    model_config = {"from_attributes": True}


class ConfiguracionUpdate(BaseModel):
    ancho_salon: Optional[int] = Field(None, gt=0)
    alto_salon: Optional[int] = Field(None, gt=0)
    nombre_establecimiento: Optional[str] = None
