# GET /historial/: consulta del historial de cambios de estado (RF-21).
#
# El router de historial era uno de los tres del backend sin suite unitaria —junto con
# mesas y sectores, que ya la tienen— así que RF-21 dependía por completo del spec e2e
# `08-historial.spec.ts`, que corre contra la base real y tarda minutos. Un filtro roto
# acá dejaba `pytest` en verde.
#
# Las filas se insertan directo con `db` en vez de provocarlas por la API: `created_at`
# tiene `server_default=func.now()`, así que haciendo PATCH /mesas/{id}/estado los tres
# cambios caerían en el mismo milisegundo y no habría rango que filtrar. Lo que se prueba
# acá es el filtrado, no cómo se escribe el historial (eso es test_mesas.py).

from datetime import datetime

from app.models.historial import HistorialEstado, OrigenCambio
from app.models.mesa import EstadoMesa


def _fila(db, mesa_id: int, estado: EstadoMesa, momento: datetime) -> HistorialEstado:
    """Una fila de historial con `created_at` puesto a mano.

    Naive y no aware a propósito: la base de tests es SQLite, que guarda naive, y es lo
    mismo que hace `func.now()` en las dos bases (ver `services/horario.como_utc`).
    """
    fila = HistorialEstado(mesa_id=mesa_id, estado=estado, created_at=momento, origen_cambio=OrigenCambio.manual)
    db.add(fila)
    db.commit()
    db.refresh(fila)
    return fila


# ------------------------------------------------------------- filtro por mesa


def test_filtra_por_mesa(client, como, crear_mesa, db):
    """`mesa_id` deja solo las filas de esa mesa.

    Hay historial de DOS mesas a propósito: con una sola, un endpoint que ignorara el
    filtro devolvería exactamente lo mismo que uno que lo aplica.
    """
    mesa_a = crear_mesa(numero=1)
    mesa_b = crear_mesa(numero=2, sector_id=mesa_a.sector_id)
    _fila(db, mesa_a.id, EstadoMesa.ocupada, datetime(2026, 9, 1, 12, 0))
    _fila(db, mesa_b.id, EstadoMesa.ocupada, datetime(2026, 9, 1, 13, 0))
    como("admin")

    cuerpo = client.get("/historial/", params={"mesa_id": mesa_a.id}).json()

    assert [f["mesa_id"] for f in cuerpo] == [mesa_a.id]

    # Y sin el filtro vienen las dos: confirma que la de mesa_b existía y que lo que la
    # dejó afuera fue el parámetro, no que nunca se hubiera guardado.
    assert len(client.get("/historial/").json()) == 2


# -------------------------------------------------------- filtro por rango de fechas


def test_filtra_por_rango_de_fechas(client, como, crear_mesa, db):
    """El rango recorta por `created_at`, con los dos bordes inclusivos.

    Tres cambios en tres días distintos y una ventana que cubre solo el del medio: así
    el caso ejercita los dos cortes, el de abajo y el de arriba. Una ventana abierta de
    un lado dejaría pasar un endpoint que solo aplicara uno de los dos filtros.
    """
    mesa = crear_mesa()
    _fila(db, mesa.id, EstadoMesa.ocupada, datetime(2026, 9, 1, 20, 0))
    _fila(db, mesa.id, EstadoMesa.pendiente_limpieza, datetime(2026, 9, 2, 20, 0))
    _fila(db, mesa.id, EstadoMesa.libre, datetime(2026, 9, 3, 20, 0))
    como("admin")

    cuerpo = client.get(
        "/historial/",
        params={"fecha_inicio": "2026-09-02T00:00:00", "fecha_fin": "2026-09-02T23:59:59"},
    ).json()

    assert [f["estado"] for f in cuerpo] == ["pendiente_limpieza"]


def test_rango_invertido_da_400(client, como, crear_mesa):
    """`fecha_inicio` posterior a `fecha_fin` se rechaza, no devuelve vacío.

    La diferencia importa para la UI: un rango invertido es un error de quien consulta
    —típicamente los dos campos cargados al revés— y una lista vacía se lee como "no hubo
    movimientos en ese período", que es una respuesta distinta y equivocada.
    """
    crear_mesa()
    como("admin")

    respuesta = client.get(
        "/historial/",
        params={"fecha_inicio": "2026-09-03T00:00:00", "fecha_fin": "2026-09-01T00:00:00"},
    )

    assert respuesta.status_code == 400
    assert "no puede ser posterior" in respuesta.json()["detail"]


# ------------------------------------------------------------------ autenticación


def test_sin_autenticar_da_401(client, crear_mesa):
    """El router exige sesión. Sin `como()`, como en test_mesas.py."""
    crear_mesa()
    assert client.get("/historial/").status_code == 401
