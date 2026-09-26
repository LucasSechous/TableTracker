# Estado dudoso: posible error de detección (T26-188, RF-27).
#
# Lo que hay que proteger acá es que la alerta NO se encienda de más. El criterio tiene tres
# condiciones y las tres existen para descartar casos que parecen fallas y no lo son: una
# mesa 'libre' que nadie toca en días es el estado normal del salón, y una mesa sin ROI no
# puede actualizarse sola por definición. Un test que solo verifique el caso positivo dejaría
# pasar una alerta que marca todo el salón, que es exactamente lo que la Fase 1 descartó.

from datetime import datetime, time, timezone

import pytest

from app.models.configuracion import ConfiguracionGeneral
from app.models.mesa import EstadoMesa
from app.services.estado_dudoso import es_estado_dudoso, marcar_estados_dudosos

# Ventana de servicio de referencia: abre 07:00, cierra 01:00 (cruza medianoche, que es el
# caso normal de un restaurante y el que está cargado en la instalación real).
APERTURA = time(7, 0)
CIERRE = time(1, 0)

# Instantes de prueba expresados en hora LOCAL y convertidos a UTC, que es lo que maneja el
# servicio. Fijarlos en UTC directamente escondería el desfase del huso y el test pasaría
# aunque el recorte estuviera corrido tres horas.
def _momento_local(hora, minuto=0):
    from app.services.horario import TZ_LOCAL

    return datetime(2026, 9, 10, hora, minuto, tzinfo=TZ_LOCAL).astimezone(timezone.utc)


CERRADO = _momento_local(3, 0)  # 03:00, entre el cierre y la apertura
ABIERTO = _momento_local(13, 0)  # 13:00, pleno servicio


@pytest.fixture
def config(db):
    """Fila singleton con el horario de servicio cargado."""

    def _crear(apertura=APERTURA, cierre=CIERRE):
        fila = db.query(ConfiguracionGeneral).filter(ConfiguracionGeneral.id == 1).first()
        if fila is None:
            fila = ConfiguracionGeneral(id=1)
            db.add(fila)
        fila.hora_apertura = apertura
        fila.hora_cierre = cierre
        db.commit()
        return fila

    return _crear


@pytest.fixture
def mesa_vigilada(crear_mesa, crear_camara, crear_roi):
    """Mesa con ROI activo en cámara activa: la única que puede ser dudosa."""

    def _crear(estado=EstadoMesa.ocupada, roi_activa=True, camara_activa=True):
        camara = crear_camara(activa=camara_activa)
        mesa = crear_mesa(estado=estado)
        crear_roi(mesa_id=mesa.id, camara_id=camara.id, activa=roi_activa)
        return mesa

    return _crear


def _dudosa(db, mesa, momento):
    marcar_estados_dudosos(db, [mesa], momento=momento)
    return mesa.estado_dudoso


# --------------------------------------------------- los cuatro casos del ticket


def test_ocupada_con_roi_fuera_de_horario_es_dudosa(db, config, mesa_vigilada):
    config()
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada)

    assert _dudosa(db, mesa, CERRADO) is True


def test_la_misma_mesa_dentro_del_horario_no_es_dudosa(db, config, mesa_vigilada):
    """El local abierto explica que la mesa esté ocupada: no hay nada que reportar."""
    config()
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada)

    assert _dudosa(db, mesa, ABIERTO) is False


def test_ocupada_sin_roi_nunca_es_dudosa(db, config, crear_mesa):
    """Sin cobertura de cámara la mesa no puede actualizarse sola: es un hueco de setup.

    Se prueba a las dos horas para dejar claro que la condición 2 corta sola, sin depender
    de que además esté dentro del horario.
    """
    config()
    mesa = crear_mesa(estado=EstadoMesa.ocupada)

    assert _dudosa(db, mesa, CERRADO) is False
    assert _dudosa(db, mesa, ABIERTO) is False


@pytest.mark.parametrize(
    "estado", [EstadoMesa.libre, EstadoMesa.reservada, EstadoMesa.pendiente_limpieza]
)
def test_los_otros_estados_nunca_son_dudosos(db, config, mesa_vigilada, estado):
    """Solo 'ocupada' obliga a la detección a actuar; en el resto, no tocar es correcto.

    Es el caso que hace inviable el criterio ingenuo de "no se actualizó en N horas": una
    mesa 'libre' y vacía no se actualiza NUNCA, y son casi todas las del salón.
    """
    config()
    mesa = mesa_vigilada(estado=estado)

    assert _dudosa(db, mesa, CERRADO) is False


# --------------------------------------------------- horario sin configurar


def test_sin_horario_configurado_no_marca_nada(db, config, mesa_vigilada):
    """Consistente con T26-171: sin horario cargado en_horario_de_servicio() da True siempre.

    Con `dentro_del_horario` siempre True nunca se está fuera, así que la alerta queda
    apagada. Es el mismo default con el que arranca minutos_limpieza_demorada (T26-173):
    una instalación que todavía no declaró su horario no debería recibir avisos basados en
    un cierre que nadie cargó.
    """
    config(apertura=None, cierre=None)
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada)

    assert _dudosa(db, mesa, CERRADO) is False
    assert _dudosa(db, mesa, ABIERTO) is False


def test_sin_fila_de_configuracion_no_rompe(db, mesa_vigilada):
    """Ni siquiera existe la fila singleton: tiene que responder False, no explotar."""
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada)

    assert _dudosa(db, mesa, CERRADO) is False


# --------------------------------------------------- bordes de la cobertura


def test_roi_dado_de_baja_no_cuenta_como_cobertura(db, config, mesa_vigilada):
    config()
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada, roi_activa=False)

    assert _dudosa(db, mesa, CERRADO) is False


def test_camara_dada_de_baja_no_cuenta_como_cobertura(db, config, mesa_vigilada):
    """El ROI sigue activo pero su cámara no: nadie está mirando esa mesa."""
    config()
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada, camara_activa=False)

    assert _dudosa(db, mesa, CERRADO) is False


def test_justo_en_la_hora_de_cierre_todavia_no_es_dudosa(db, config, mesa_vigilada):
    """El cierre es inclusivo (T26-171), así que a la hora exacta el local sigue abierto.

    Fija el borde para que no se convierta en exclusivo por descuido: cambiarlo movería
    también el recorte de las métricas de rotación, que usan la misma función.
    """
    config()
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada)

    assert _dudosa(db, mesa, _momento_local(CIERRE.hour, CIERRE.minute)) is False
    # Un minuto después ya está cerrado.
    assert _dudosa(db, mesa, _momento_local(CIERRE.hour, CIERRE.minute + 1)) is True


# --------------------------------------------------- la regla pura, sin base


@pytest.mark.parametrize(
    "estado,cobertura,dentro,esperado",
    [
        (EstadoMesa.ocupada, True, False, True),  # el único caso positivo
        (EstadoMesa.ocupada, True, True, False),
        (EstadoMesa.ocupada, False, False, False),
        (EstadoMesa.libre, True, False, False),
        (EstadoMesa.reservada, True, False, False),
        (EstadoMesa.pendiente_limpieza, True, False, False),
    ],
)
def test_tabla_de_verdad_del_criterio(estado, cobertura, dentro, esperado):
    """Las tres condiciones son un AND: basta que falle una para no marcar."""
    assert es_estado_dudoso(estado, cobertura, dentro) is esperado


# --------------------------------------------------- el endpoint


def test_el_listado_expone_el_campo(client, como, db, config, mesa_vigilada, crear_mesa):
    """GET /mesas/ trae estado_dudoso para todas, no solo para las marcadas."""
    config()
    mesa_vigilada(estado=EstadoMesa.ocupada)
    crear_mesa(estado=EstadoMesa.libre)
    como("mozo")

    cuerpo = client.get("/mesas/").json()
    assert len(cuerpo) == 2
    assert all("estado_dudoso" in m for m in cuerpo)
    # Con la hora real del test no se puede afirmar cuál está marcada —depende de a qué hora
    # corra la suite—, así que acá solo se verifica el contrato. El criterio ya está cubierto
    # arriba con instantes fijos.
    assert all(isinstance(m["estado_dudoso"], bool) for m in cuerpo)


def test_el_detalle_expone_el_campo(client, como, db, config, mesa_vigilada):
    """GET /mesas/{id} tiene que coincidir con el listado, no quedar en el default."""
    config()
    mesa = mesa_vigilada(estado=EstadoMesa.ocupada)
    como("mozo")

    detalle = client.get(f"/mesas/{mesa.id}").json()
    del_listado = next(m for m in client.get("/mesas/").json() if m["id"] == mesa.id)
    assert detalle["estado_dudoso"] == del_listado["estado_dudoso"]


def test_una_mesa_recien_creada_no_viene_marcada(client, como, crear_sector):
    """El POST devuelve el default sin evaluar el criterio: False, no null."""
    sector = crear_sector()
    como("encargado")

    respuesta = client.post("/mesas/", json={"numero": 99, "sector_id": sector.id})
    assert respuesta.status_code == 201
    assert respuesta.json()["estado_dudoso"] is False
