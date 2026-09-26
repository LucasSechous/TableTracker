# Horario de servicio del local y recorte de métricas a esa franja (T26-171).
#
# Problema que resuelve: GET /metricas/rotacion contaba las 24 horas del día, así que
# un día de servicio se mezclaba con la madrugada del local cerrado. El promedio
# resultante subestima la actividad real y hace incomparables dos locales con horarios
# distintos.

import os
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

# Huso contra el que se interpreta la franja horaria. Una sola zona y no una columna
# por local: TableTracker administra UN local físico, así que no existe el caso de dos
# husos conviviendo. Se deja override por entorno para no tener que tocar código si el
# sistema se instala en otro lado.
#
# En Windows, zoneinfo no encuentra ninguna zona sin el paquete `tzdata` instalado
# (viene declarado en requirements.txt justamente por esto).
TZ_LOCAL = ZoneInfo(os.getenv("TZ_LOCAL", "America/Montevideo"))


def como_utc(momento: datetime) -> datetime:
    """Normaliza un datetime a aware en UTC.

    `created_at` es timestamptz y llega como datetime con tzinfo desde Postgres, pero
    la base de tests es SQLite y devuelve datetimes naive. Un naive se asume UTC, que
    es lo que efectivamente guarda `func.now()` en las dos bases; interpretarlo como
    otra cosa desplazaría todo el recorte sin que nada falle a la vista. Sin esto,
    restar dos datetimes de origen mixto (uno de la base, otro armado en código) tira
    TypeError; con awareness mixta pero sin resta de por medio, el error es mudo:
    el resultado sale mal sin ninguna excepción que avise.
    """
    if momento.tzinfo is None:
        return momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(timezone.utc)


def hora_local(momento: datetime) -> time:
    """La hora del reloj del local para un instante dado."""
    return como_utc(momento).astimezone(TZ_LOCAL).time()


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


def hoy_local() -> date:
    """La fecha de hoy en el reloj del local, no en UTC.

    Cerca de medianoche UTC difiere de `date.today()`: TZ_LOCAL es UTC-3, así que
    entre las 21:00 y las 23:59 UTC ya es "mañana" en Montevideo.
    """
    return datetime.now(timezone.utc).astimezone(TZ_LOCAL).date()


def rango_dia_operativo(fecha: date, apertura: time | None, cierre: time | None) -> tuple[datetime, datetime]:
    """El (inicio, fin) en UTC del "día operativo" de `fecha" (T26-185, RF-32).

    No es medianoche a medianoche: un local que cierra después de medianoche (20:00 -> 02:00,
    el caso normal de un restaurante) tiene un turno que cruza la fecha civil. Cortar por
    medianoche partiría ese turno en dos días y diluiría el % de ocupación de ambos, que es
    justo lo que este reporte busca evitar. En cambio, el día operativo de `fecha` arranca en
    `apertura` de `fecha` y termina en `cierre` — del día siguiente si el horario cruza
    medianoche, del mismo día si no.

    Sin horario cargado, o con apertura == cierre ("abierto 24h", ver en_horario_de_servicio),
    no hay franja real contra la cual anclar: se usa medianoche a medianoche de `fecha`, el
    mismo criterio que usaría cualquier reporte diario sin este ticket.
    """
    if apertura is None or cierre is None or apertura == cierre:
        inicio_local = datetime.combine(fecha, time.min, tzinfo=TZ_LOCAL)
        fin_local = datetime.combine(fecha + timedelta(days=1), time.min, tzinfo=TZ_LOCAL)
    elif apertura < cierre:
        inicio_local = datetime.combine(fecha, apertura, tzinfo=TZ_LOCAL)
        fin_local = datetime.combine(fecha, cierre, tzinfo=TZ_LOCAL)
    else:
        inicio_local = datetime.combine(fecha, apertura, tzinfo=TZ_LOCAL)
        fin_local = datetime.combine(fecha + timedelta(days=1), cierre, tzinfo=TZ_LOCAL)

    return inicio_local.astimezone(timezone.utc), fin_local.astimezone(timezone.utc)
