# Horario de servicio del local y recorte de métricas a esa franja (T26-171).
#
# Problema que resuelve: GET /metricas/rotacion contaba las 24 horas del día, así que
# un día de servicio se mezclaba con la madrugada del local cerrado. El promedio
# resultante subestima la actividad real y hace incomparables dos locales con horarios
# distintos.

import os
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

# Huso contra el que se interpreta la franja horaria. Una sola zona y no una columna
# por local: TableTracker administra UN local físico, así que no existe el caso de dos
# husos conviviendo. Se deja override por entorno para no tener que tocar código si el
# sistema se instala en otro lado.
#
# En Windows, zoneinfo no encuentra ninguna zona sin el paquete `tzdata` instalado
# (viene declarado en requirements.txt justamente por esto).
TZ_LOCAL = ZoneInfo(os.getenv("TZ_LOCAL", "America/Montevideo"))


def hora_local(momento: datetime) -> time:
    """La hora del reloj del local para un instante dado.

    `created_at` es timestamptz y llega como datetime con tzinfo desde Postgres, pero
    la base de tests es SQLite y devuelve datetimes naive. Un naive se asume UTC, que
    es lo que efectivamente guarda `func.now()` en las dos bases; interpretarlo como
    hora local desplazaría todo el recorte tres horas sin que nada falle a la vista.
    """
    if momento.tzinfo is None:
        momento = momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(TZ_LOCAL).time()


def en_horario_de_servicio(momento: datetime, apertura: time | None, cierre: time | None) -> bool:
    """Si un instante cae dentro de la franja de servicio configurada.

    Sin horario cargado devuelve True para todo: el comportamiento por defecto tiene que
    ser el histórico (contar las 24 horas), no un recorte que nadie pidió.

    El caso que hay que tratar bien es el del local que cierra después de medianoche
    —apertura 20:00, cierre 02:00—, que es lo habitual en un restaurante. Ahí la franja
    NO es el intervalo [apertura, cierre]: es su complemento, todo lo que quede después
    de abrir o antes de cerrar. Compararlo de la forma ingenua (apertura <= hora <=
    cierre) da un rango vacío y el conteo saldría cero sin que nada avise.
    """
    if apertura is None or cierre is None:
        return True

    hora = hora_local(momento)

    if apertura == cierre:
        # Apertura y cierre iguales se leen como "todo el día", no como un instante
        # único: un local abierto 24h es más plausible que uno abierto un segundo.
        return True

    if apertura < cierre:
        return apertura <= hora <= cierre

    # Cruza medianoche.
    return hora >= apertura or hora <= cierre
