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
    # Umbrales de detección de vision-module (T26-183, RF-28): siempre tienen un valor,
    # nunca None, porque la columna es NOT NULL con default desde que se creó.
    confirmacion_segundos: float
    overlap_minimo: float

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
    # Mismos límites que vision-module/app/main.py:validar_configuracion() aplicaba sobre
    # el .env: > 0 sin techo para la confirmación, fracción (0, 1] para el overlap.
    confirmacion_segundos: Optional[float] = Field(None, gt=0)
    overlap_minimo: Optional[float] = Field(None, gt=0, le=1)


class ConfiguracionActualizadaResponse(ConfiguracionResponse):
    # Valores previos de los umbrales de detección, solo cuando el PATCH los cambió
    # (T26-183): cambiarlos en caliente altera la detección en curso sin que nadie lo vea
    # venir, así que la respuesta deja constancia de qué valía antes en vez de que la única
    # traza quede en el WARNING que loguea vision-module al releer.
    confirmacion_segundos_anterior: Optional[float] = None
    overlap_minimo_anterior: Optional[float] = None
