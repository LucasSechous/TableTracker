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
    # Alerta de alta ocupación (T26-187, RF-26). Se devuelven los dos: el umbral vigente
    # además del booleano, porque el consumidor necesita poder decir "92% (umbral 85%)" sin
    # pedir /configuracion aparte. Que la comparación la resuelva el backend evita que cada
    # cliente reimplemente el >= y que dos pantallas discrepen sobre si el salón está al
    # límite.
    umbral_ocupacion_alta: float
    ocupacion_alta: bool


class RotacionMesaResponse(BaseModel):
    mesa_id: int
    numero: int
    sector_id: int
    rotaciones: int
