# Schema Pydantic para las métricas agregadas de ocupación.
# No hay modelo/tabla propia: estos shapes solo describen la salida de una
# consulta agregada sobre mesas (T26-154).

from datetime import date, datetime, time
from typing import Optional

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
    # Horario de servicio (T26-200/F-2). Mismo criterio que el par de arriba: la pregunta
    # "¿está abierto AHORA?" la responde el backend y llega resuelta, en vez de que cada
    # cliente reimplemente la regla. Importa más que en el caso del umbral, porque acá la
    # regla no es un `>=`: incluye el cruce de medianoche (un local que abre 20:00 y cierra
    # 02:00 tiene por franja el COMPLEMENTO del intervalo) y, sobre todo, se evalúa contra
    # TZ_LOCAL. El frontend solo tiene el reloj del navegador, así que su copia daba una
    # respuesta distinta a la del backend para el mismo instante si el navegador estaba en
    # otro huso.
    #
    # Las dos horas viajan por la misma razón que viaja `umbral_ocupacion_alta`: para poder
    # rotular el aviso ("servicio de 07:00 a 01:00") sin pedir /configuracion por separado.
    # Son None cuando no hay horario cargado, caso en el que `local_abierto` es True — el
    # default es "siempre en horario", ver en_horario_de_servicio.
    local_abierto: bool
    hora_apertura: Optional[time]
    hora_cierre: Optional[time]


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
