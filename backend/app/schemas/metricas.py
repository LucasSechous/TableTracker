# Schema Pydantic para las métricas agregadas de ocupación.
# No hay modelo/tabla propia: estos shapes solo describen la salida de una
# consulta agregada sobre mesas (T26-154).

from pydantic import BaseModel


class ConteoPorEstado(BaseModel):
    libre: int = 0
    ocupada: int = 0
    pendiente_limpieza: int = 0
    reservada: int = 0


class OcupacionResponse(BaseModel):
    total_mesas: int
    porcentaje_ocupacion: float
    conteo_por_estado: ConteoPorEstado


class RotacionMesaResponse(BaseModel):
    mesa_id: int
    numero: int
    sector_id: int
    rotaciones: int
