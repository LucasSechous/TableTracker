# GET/PATCH /configuracion: fila singleton de configuracion_general (T26-132, T26-156).
# No existía suite para este router; se cubre completo de una vez.

import pytest

from app.models.configuracion import ConfiguracionGeneral


@pytest.fixture
def crear_configuracion(db):
    def _crear(**campos):
        config = ConfiguracionGeneral(id=1, **campos)
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    return _crear


def test_get_sin_fila_da_404(client, como):
    como("admin")
    assert client.get("/configuracion").status_code == 404


def test_get_devuelve_los_valores(client, como, crear_configuracion):
    crear_configuracion(nombre_establecimiento="La Parrilla", cantidad_mesas_referencia=20)
    como("mozo")

    cuerpo = client.get("/configuracion").json()
    assert cuerpo == {
        "ancho_salon": 1200,
        "alto_salon": 700,
        "nombre_establecimiento": "La Parrilla",
        "cantidad_mesas_referencia": 20,
    }


def test_patch_actualiza_cantidad_mesas_referencia(client, como, crear_configuracion):
    crear_configuracion()
    como("admin")

    respuesta = client.patch("/configuracion", json={"cantidad_mesas_referencia": 15})
    assert respuesta.status_code == 200
    assert respuesta.json()["cantidad_mesas_referencia"] == 15


def test_patch_no_pisa_campos_no_enviados(client, como, crear_configuracion):
    crear_configuracion(nombre_establecimiento="La Parrilla", ancho_salon=1500, cantidad_mesas_referencia=10)
    como("admin")

    respuesta = client.patch("/configuracion", json={"cantidad_mesas_referencia": 12})
    cuerpo = respuesta.json()
    assert cuerpo["nombre_establecimiento"] == "La Parrilla"
    assert cuerpo["ancho_salon"] == 1500
    assert cuerpo["cantidad_mesas_referencia"] == 12


def test_patch_cantidad_mesas_referencia_no_positiva_da_422(client, como, crear_configuracion):
    crear_configuracion()
    como("admin")
    assert client.patch("/configuracion", json={"cantidad_mesas_referencia": 0}).status_code == 422


def test_patch_exige_admin(client, como, crear_configuracion):
    crear_configuracion()
    como("encargado")
    assert client.patch("/configuracion", json={"cantidad_mesas_referencia": 8}).status_code == 403


def test_sin_autenticar_da_401(client, crear_configuracion):
    crear_configuracion()
    assert client.get("/configuracion").status_code == 401
