# Reconstrucción de tiempo por estado a partir de historial_estados (T26-185, RF-32).
#
# historial_estados guarda eventos puntuales (mesa_id, estado, created_at), no rangos: el
# fin de un estado se infiere del created_at de la fila siguiente de esa misma mesa. Este
# módulo hace esa reconstrucción para un rango [inicio, fin) arbitrario, no para una fecha
# fija, a propósito: es la pieza que también necesita RF-33 (reporte por período), que solo
# difiere en cómo agrupa los rangos, no en cómo se calcula cada uno.
#
# T26-186 (RF-24) confirmó esa apuesta: los horarios de mayor demanda son la MISMA
# reconstrucción agrupada por hora del reloj en vez de por mesa. Por eso la línea de tiempo
# se extrajo a _intervalos_por_mesa() y las dos agregaciones se apoyan en ella.

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.historial import HistorialEstado
from app.models.mesa import EstadoMesa, Mesa
from app.services.horario import TZ_LOCAL, como_utc


def _intervalos_por_mesa(
    db: Session,
    mesas: list[Mesa],
    inicio: datetime,
    fin: datetime,
    ahora: datetime | None = None,
) -> dict[int, list[tuple[EstadoMesa, datetime, datetime]]]:
    """Los tramos (estado, desde, hasta) de cada mesa dentro de [inicio, fin).

    Es la reconstrucción de la línea de tiempo, sin agregar: quién la llama decide si suma
    los tramos por estado (calcular_ocupacion_por_mesa) o los reparte en franjas horarias
    (calcular_demanda_por_franja). Se extrajo al sumar RF-24 para no dejar una tercera copia
    de la resolución de carry-in —ya hay otra en obtener_rotacion— conviviendo con esta.

    Devuelve solo las mesas con datos dentro del rango: una mesa sin ninguna evidencia de
    actividad ese día (inactiva, sin historial previo ni posterior a inicio) queda afuera del
    dict en vez de con ceros, para que el llamador no tenga que distinguir "0 minutos porque
    estuvo así todo el rango" de "no hay nada que reportar de esta mesa".

    `ahora` es inyectable para poder fijar "el presente" desde los tests: el cálculo nunca
    proyecta al futuro, así que un rango que incluye el momento actual se corta ahí, no en su
    `fin` teórico.
    """
    # inicio/fin llegan aware (rango_dia_operativo siempre devuelve UTC-aware), pero
    # created_at puede volver naive de SQLite (ver como_utc) — normalizar todo acá evita
    # mezclar awareness más abajo, donde restar dos datetimes de origen distinto tira
    # TypeError.
    inicio = como_utc(inicio)
    fin = como_utc(fin)
    ahora = como_utc(ahora) if ahora is not None else datetime.now(timezone.utc)
    fin_efectivo = min(fin, ahora)
    if not mesas or fin_efectivo <= inicio:
        return {}

    mesa_ids = [mesa.id for mesa in mesas]

    # Carry-in: en qué estado entra cada mesa al rango, y desde cuándo. Sin fila previa se
    # asume 'libre' (mismo criterio que el arrastre de obtener_rotacion): es el estado por
    # default de una mesa nueva, así que no haber tenido nunca un cambio de estado es
    # indistinguible de "siempre estuvo libre".
    corte = (
        db.query(
            HistorialEstado.mesa_id.label("mesa_id"),
            func.max(HistorialEstado.created_at).label("corte"),
        )
        .filter(HistorialEstado.mesa_id.in_(mesa_ids), HistorialEstado.created_at < inicio)
        .group_by(HistorialEstado.mesa_id)
        .subquery()
    )
    filas_previas = db.query(
        HistorialEstado.mesa_id, HistorialEstado.estado, HistorialEstado.created_at
    ).join(
        corte,
        and_(HistorialEstado.mesa_id == corte.c.mesa_id, HistorialEstado.created_at == corte.c.corte),
    )
    carry_in: dict[int, tuple[EstadoMesa, datetime]] = {
        mesa_id: (estado, como_utc(created_at)) for mesa_id, estado, created_at in filas_previas
    }

    filas_rango = (
        db.query(HistorialEstado)
        .filter(
            HistorialEstado.mesa_id.in_(mesa_ids),
            HistorialEstado.created_at >= inicio,
            HistorialEstado.created_at < fin_efectivo,
        )
        .order_by(HistorialEstado.mesa_id, HistorialEstado.created_at)
        .all()
    )
    filas_por_mesa: dict[int, list[tuple[EstadoMesa, datetime]]] = defaultdict(list)
    for fila in filas_rango:
        filas_por_mesa[fila.mesa_id].append((fila.estado, como_utc(fila.created_at)))

    resultado: dict[int, list[tuple[EstadoMesa, datetime, datetime]]] = {}

    for mesa in mesas:
        filas_mesa = filas_por_mesa.get(mesa.id, [])

        if mesa.activa:
            fin_mesa = fin_efectivo
        elif filas_mesa:
            # Sin columna de fecha de baja en el esquema, se aproxima con el último evento
            # que tuvo dentro del rango: es el único dato temporal disponible para saber
            # "hasta cuándo" contarla.
            fin_mesa = min(filas_mesa[-1][1], fin_efectivo)
        else:
            # Sin filas dentro del rango no queda ninguna evidencia de actividad en este
            # día — lo único que podría haber es un carry-in, y ese es por definición
            # anterior a `inicio`. Se excluye más abajo (fin_mesa None <= inicio siempre).
            fin_mesa = None

        if fin_mesa is None or fin_mesa <= inicio:
            continue

        estado_actual = carry_in[mesa.id][0] if mesa.id in carry_in else EstadoMesa.libre
        intervalos: list[tuple[EstadoMesa, datetime, datetime]] = []
        cursor = inicio

        for estado_fila, creado_en in filas_mesa:
            intervalos.append((estado_actual, cursor, creado_en))
            estado_actual = estado_fila
            cursor = creado_en

        intervalos.append((estado_actual, cursor, fin_mesa))
        resultado[mesa.id] = intervalos

    return resultado


def calcular_ocupacion_por_mesa(
    db: Session,
    mesas: list[Mesa],
    inicio: datetime,
    fin: datetime,
    ahora: datetime | None = None,
) -> dict[int, dict[str, float]]:
    """Minutos por estado, por mesa, dentro de [inicio, fin).

    Devuelve solo las mesas con datos dentro del rango: una mesa sin ninguna evidencia de
    actividad ese día (inactiva, sin historial previo ni posterior a inicio) queda afuera del
    dict en vez de con ceros, para que el llamador no tenga que distinguir "0 minutos porque
    estuvo así todo el rango" de "no hay nada que reportar de esta mesa".

    `ahora` es inyectable para poder fijar "el presente" desde los tests: el cálculo nunca
    proyecta al futuro, así que un rango que incluye el momento actual se corta ahí, no en su
    `fin` teórico.
    """
    resultado: dict[int, dict[str, float]] = {}
    for mesa_id, intervalos in _intervalos_por_mesa(db, mesas, inicio, fin, ahora).items():
        tiempos = {estado.value: 0.0 for estado in EstadoMesa}
        for estado, desde, hasta in intervalos:
            tiempos[estado.value] += (hasta - desde).total_seconds() / 60
        resultado[mesa_id] = tiempos
    return resultado


def calcular_demanda_por_franja(
    db: Session,
    mesas: list[Mesa],
    dias: list[tuple[datetime, datetime]],
    ahora: datetime | None = None,
) -> dict[int, dict[str, float]]:
    """Minutos por estado agrupados por HORA DEL RELOJ LOCAL (T26-186, RF-24).

    `dias` es la lista de ventanas (inicio, fin) de cada día operativo del período pedido —
    las arma rango_dia_operativo(), una por fecha. Se reciben ya calculadas en vez de una
    fecha desde/hasta porque el corte del día operativo es decisión de T26-185 y no tiene
    por qué re-deducirse acá.

    La clave del dict es la hora local (0-23), no la UTC: "el pico es a las 21" tiene que
    leerse en el reloj del local. Con TZ_LOCAL en UTC-3 las dos difieren en tres horas, así
    que agrupar por UTC correría todo el gráfico sin que nada falle a la vista.

    Un intervalo que cruza el borde de una hora se reparte proporcionalmente entre las dos
    franjas en vez de imputarse entero a la de inicio: una mesa ocupada de 20:50 a 21:40 son
    10 minutos en la franja de 20 y 30 en la de 21, no 50 en la de 20. Sin esto, una
    ocupación larga inflaría la franja en la que arrancó y dejaría vacías las siguientes,
    que es exactamente el pico falso que este reporte tiene que evitar.
    """
    acumulado: dict[int, dict[str, float]] = {}

    for inicio, fin in dias:
        for intervalos in _intervalos_por_mesa(db, mesas, inicio, fin, ahora).values():
            for estado, desde, hasta in intervalos:
                _repartir_en_franjas(acumulado, estado, desde, hasta)

    return acumulado


def _repartir_en_franjas(
    acumulado: dict[int, dict[str, float]], estado: EstadoMesa, desde: datetime, hasta: datetime
) -> None:
    """Suma [desde, hasta) a las franjas horarias locales que toca, cortando en cada borde."""
    cursor = desde
    while cursor < hasta:
        local = cursor.astimezone(TZ_LOCAL)
        # Inicio de la hora siguiente, en local y de vuelta a UTC. Se recalcula por vuelta y
        # no se suma una hora fija: en un cambio de horario de verano la franja dura 0 o 2
        # horas reales, y sumar 3600s saltearía o duplicaría el borde.
        proximo_borde = (local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).astimezone(
            timezone.utc
        )
        corte = min(proximo_borde, hasta)
        minutos = (corte - cursor).total_seconds() / 60
        if minutos > 0:
            franja = acumulado.setdefault(local.hour, {e.value: 0.0 for e in EstadoMesa})
            franja[estado.value] += minutos
        cursor = corte
