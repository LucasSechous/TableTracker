# Schema Pydantic para las métricas agregadas de ocupación.
# No hay modelo/tabla propia: estos shapes solo describen la salida de una
# consulta agregada sobre mesas (T26-154).

from datetime import date, datetime

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


# Minutos, no un conteo: a diferencia de ConteoPorEstado (una foto instantánea), acá cada
# mesa contribuye tiempo, reconstruido a partir de historial_estados (T26-185, RF-32).
class TiempoPorEstado(BaseModel):
    libre: float = 0
    ocupada: float = 0
    pendiente_limpieza: float = 0
    reservada: float = 0


class OcupacionDiariaMesaResponse(BaseModel):
    mesa_id: int
    numero: int
    sector_id: int
    minutos_por_estado: TiempoPorEstado
    porcentaje_ocupacion: float


class OcupacionDiariaResponse(BaseModel):
    fecha: date
    # Bordes reales del día operativo usado para el cálculo (T26-171): el frontend los
    # muestra tal cual en vez de recalcularlos, para no duplicar la lógica de corte de día.
    inicio: datetime
    fin: datetime
    total_mesas: int
    porcentaje_ocupacion: float
    minutos_por_estado: TiempoPorEstado
    mesas: list[OcupacionDiariaMesaResponse]


# Una franja horaria del reporte de demanda (T26-186, RF-24).
#
# `hora` es la hora del reloj LOCAL (0-23), no UTC: el reporte responde "¿a qué hora se llena
# el salón?" y esa pregunta se contesta en el reloj del local.
#
# Se devuelven los minutos además del porcentaje para que el consumidor pueda juzgar cuánto
# pesa cada barra: 100% sobre 20 minutos medidos no es lo mismo que 100% sobre 18 horas, y
# sin el crudo el gráfico invita a leer una tendencia donde solo hay una muestra chica.
class DemandaFranjaResponse(BaseModel):
    hora: int
    porcentaje_ocupacion: float
    minutos_ocupada: float
    minutos_medidos: float


class DemandaResponse(BaseModel):
    fecha_inicio: date
    fecha_fin: date
    # Días operativos efectivamente incluidos. Es el tamaño de muestra del reporte: con 1 día
    # el resultado es una anécdota, no un patrón, y la UI lo dice en vez de dibujar un pico.
    dias: int
    franjas: list[DemandaFranjaResponse]
