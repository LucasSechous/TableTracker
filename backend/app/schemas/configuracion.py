from datetime import time
from pydantic import BaseModel, Field
from typing import Optional


class ConfiguracionResponse(BaseModel):
    ancho_salon: int
    alto_salon: int
    nombre_establecimiento: Optional[str]
    cantidad_mesas_referencia: Optional[int]
    # Horario de servicio (T26-171). None mientras no se cargue, y en ese caso las
    # métricas siguen contando las 24 horas.
    hora_apertura: Optional[time]
    hora_cierre: Optional[time]
    # None = la alerta de limpieza demorada está apagada (T26-173).
    minutos_limpieza_demorada: Optional[int]

    model_config = {"from_attributes": True}


class ConfiguracionUpdate(BaseModel):
    ancho_salon: Optional[int] = Field(None, gt=0)
    alto_salon: Optional[int] = Field(None, gt=0)
    nombre_establecimiento: Optional[str] = None
    cantidad_mesas_referencia: Optional[int] = Field(None, gt=0)
    # No se valida que apertura < cierre: un local que abre 20:00 y cierra 02:00 es el
    # caso normal, no un error de carga. La franja que cruza medianoche la resuelve
    # app/services/horario.en_horario_de_servicio().
    hora_apertura: Optional[time] = None
    hora_cierre: Optional[time] = None
    minutos_limpieza_demorada: Optional[int] = Field(None, gt=0)
