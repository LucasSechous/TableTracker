# Reconstrucción de tiempo por estado a partir de historial_estados (T26-185, RF-32).
#
# historial_estados guarda eventos puntuales (mesa_id, estado, created_at), no rangos: el
# fin de un estado se infiere del created_at de la fila siguiente de esa misma mesa. Este
# módulo hace esa reconstrucción para un rango [inicio, fin) arbitrario, no para una fecha
# fija, a propósito: es la pieza que también necesita RF-33 (reporte por período), que solo
# difiere en cómo agrupa los rangos, no en cómo se calcula cada uno.

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.historial import HistorialEstado
from app.models.mesa import EstadoMesa, Mesa
from app.services.horario import como_utc


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

    resultado: dict[int, dict[str, float]] = {}

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
        tiempos = {estado.value: 0.0 for estado in EstadoMesa}
        cursor = inicio

        for estado_fila, creado_en in filas_mesa:
            tiempos[estado_actual.value] += (creado_en - cursor).total_seconds() / 60
            estado_actual = estado_fila
            cursor = creado_en

        tiempos[estado_actual.value] += (fin_mesa - cursor).total_seconds() / 60
        resultado[mesa.id] = tiempos

    return resultado
