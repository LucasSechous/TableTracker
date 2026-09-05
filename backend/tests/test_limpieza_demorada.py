# Reloj de estado de la mesa y umbral de limpieza demorada (T26-173).
#
# Lo que hay que proteger acá es la sincronía entre historial_estados y mesas.estado_desde:
# la columna es una denormalización de la última fila del historial, y una denormalización
# solo sirve mientras no discrepe con su fuente. Si un camino cambia el estado sin mover el
# reloj, el aviso del canvas muestra minutos de un estado que ya no existe.

from datetime import datetime, timedelta, timezone

from app.models.historial import HistorialEstado
from app.models.mesa import EstadoMesa


def _estado_desde(client, mesa_id):
    mesas = client.get("/mesas/").json()
    return next(m["estado_desde"] for m in mesas if m["id"] == mesa_id)


def test_mesa_nueva_expone_estado_desde(client, como, crear_mesa):
    mesa = crear_mesa(estado=EstadoMesa.libre)
    como("admin")

    assert _estado_desde(client, mesa.id) is not None


def test_cambiar_estado_mueve_el_reloj(client, como, db, crear_mesa):
    mesa = crear_mesa(estado=EstadoMesa.libre)
    # Se retrasa el reloj a mano para que el avance sea inequívoco: sin esto, el antes y
    # el después caen en el mismo instante y el test pasaría aunque no se actualizara.
    mesa.estado_desde = datetime.now(timezone.utc) - timedelta(hours=3)
    db.commit()

    como("admin")
    previo = _estado_desde(client, mesa.id)
    assert client.patch(f"/mesas/{mesa.id}/estado", json={"estado": "ocupada"}).status_code == 200

    assert _estado_desde(client, mesa.id) > previo


def test_el_reloj_queda_alineado_con_la_ultima_fila_de_historial(client, como, db, crear_mesa):
    """La columna es una denormalización: tiene que coincidir con su fuente."""
    mesa = crear_mesa(estado=EstadoMesa.libre)
    como("admin")
    client.patch(f"/mesas/{mesa.id}/estado", json={"estado": "ocupada"})

    ultima = (
        db.query(HistorialEstado)
        .filter(HistorialEstado.mesa_id == mesa.id)
        .order_by(HistorialEstado.created_at.desc())
        .first()
    )
    db.refresh(mesa)
    # Se comparan al segundo: las dos escrituras salen del mismo commit pero cada una
    # resuelve su propio now() en la base.
    assert abs((mesa.estado_desde - ultima.created_at).total_seconds()) < 2


def test_confirmar_limpieza_tambien_mueve_el_reloj(client, como, db, crear_mesa):
    mesa = crear_mesa(estado=EstadoMesa.pendiente_limpieza)
    mesa.estado_desde = datetime.now(timezone.utc) - timedelta(hours=1)
    db.commit()

    como("admin")
    previo = _estado_desde(client, mesa.id)
    assert client.patch(f"/mesas/{mesa.id}/limpieza").status_code == 200

    assert _estado_desde(client, mesa.id) > previo


def test_reservar_tambien_mueve_el_reloj(client, como, db, crear_mesa):
    mesa = crear_mesa(estado=EstadoMesa.libre)
    mesa.estado_desde = datetime.now(timezone.utc) - timedelta(hours=1)
    db.commit()

    como("admin")
    previo = _estado_desde(client, mesa.id)
    assert client.patch(f"/mesas/{mesa.id}/reserva").status_code == 200

    assert _estado_desde(client, mesa.id) > previo


def test_el_patch_generico_de_estado_tambien_mueve_el_reloj(client, como, db, crear_mesa):
    """PATCH /mesas/{id} acepta `estado` y no escribe historial (inconsistencia previa a
    este ticket). El reloj igual tiene que avanzar: si no, una mesa que pasó a
    pendiente_limpieza por esta vía arrastraría los minutos del estado anterior y podría
    aparecer como atrasada apenas cambia."""
    mesa = crear_mesa(estado=EstadoMesa.libre)
    mesa.estado_desde = datetime.now(timezone.utc) - timedelta(hours=5)
    db.commit()

    como("admin")
    previo = _estado_desde(client, mesa.id)
    assert client.patch(f"/mesas/{mesa.id}", json={"estado": "pendiente_limpieza"}).status_code == 200

    assert _estado_desde(client, mesa.id) > previo


def test_un_patch_que_no_toca_el_estado_no_mueve_el_reloj(client, como, db, crear_mesa):
    """Mover una mesa de sector no reinicia hace cuánto está pendiente de limpieza."""
    mesa = crear_mesa(estado=EstadoMesa.pendiente_limpieza)
    mesa.estado_desde = datetime.now(timezone.utc) - timedelta(hours=2)
    db.commit()

    como("admin")
    previo = _estado_desde(client, mesa.id)
    assert client.patch(f"/mesas/{mesa.id}", json={"numero": 99}).status_code == 200

    assert _estado_desde(client, mesa.id) == previo


def test_reenviar_el_mismo_estado_no_reinicia_el_reloj_en_el_patch_generico(client, como, db, crear_mesa):
    """Guardar la mesa sin cambiarle el estado no puede blanquear el atraso: si lo hiciera,
    tocar cualquier campo desde la UI escondería una mesa que lleva rato sin limpiar."""
    mesa = crear_mesa(estado=EstadoMesa.pendiente_limpieza)
    mesa.estado_desde = datetime.now(timezone.utc) - timedelta(hours=2)
    db.commit()

    como("admin")
    previo = _estado_desde(client, mesa.id)
    assert client.patch(f"/mesas/{mesa.id}", json={"estado": "pendiente_limpieza"}).status_code == 200

    assert _estado_desde(client, mesa.id) == previo


# ------------------------------------------------ umbral en /configuracion


def test_el_umbral_se_guarda_y_se_devuelve(client, como, db):
    from app.models.configuracion import ConfiguracionGeneral

    db.add(ConfiguracionGeneral(id=1))
    db.commit()
    como("admin")

    respuesta = client.patch("/configuracion", json={"minutos_limpieza_demorada": 20})
    assert respuesta.status_code == 200
    assert respuesta.json()["minutos_limpieza_demorada"] == 20


def test_el_umbral_arranca_apagado(client, como, db):
    """Sin cargar, la alerta no existe: el canvas se ve igual que antes del ticket."""
    from app.models.configuracion import ConfiguracionGeneral

    db.add(ConfiguracionGeneral(id=1))
    db.commit()
    como("mozo")

    assert client.get("/configuracion").json()["minutos_limpieza_demorada"] is None


def test_el_umbral_rechaza_cero_y_negativos(client, como, db):
    from app.models.configuracion import ConfiguracionGeneral

    db.add(ConfiguracionGeneral(id=1))
    db.commit()
    como("admin")

    for invalido in (0, -5):
        assert client.patch("/configuracion", json={"minutos_limpieza_demorada": invalido}).status_code == 422
