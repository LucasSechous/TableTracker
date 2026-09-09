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
        # Sin cargar: con el horario en None las métricas siguen contando las 24 horas
        # (T26-171). La igualdad es exacta a propósito —no un subconjunto— para que
        # agregar un campo a la respuesta obligue a pasar por acá.
        "hora_apertura": None,
        "hora_cierre": None,
        # Sin cargar: la alerta de limpieza demorada arranca apagada (T26-173).
        "minutos_limpieza_demorada": None,
        # Umbrales de detección (T26-183): nunca None, son NOT NULL con default.
        "confirmacion_segundos": 6,
        "overlap_minimo": 0.30,
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


class TestUmbralesDeteccion:
    # T26-183: los dos parámetros que vision-module antes leía del .env.

    def test_patch_actualiza_los_umbrales(self, client, como, crear_configuracion):
        crear_configuracion()
        como("admin")

        respuesta = client.patch(
            "/configuracion", json={"confirmacion_segundos": 4, "overlap_minimo": 0.45}
        )
        cuerpo = respuesta.json()
        assert respuesta.status_code == 200
        assert cuerpo["confirmacion_segundos"] == 4
        assert cuerpo["overlap_minimo"] == 0.45

    def test_patch_devuelve_el_valor_anterior_de_lo_que_cambio(self, client, como, crear_configuracion):
        crear_configuracion(confirmacion_segundos=6, overlap_minimo=0.30)
        como("admin")

        cuerpo = client.patch("/configuracion", json={"confirmacion_segundos": 10}).json()
        assert cuerpo["confirmacion_segundos_anterior"] == 6
        # No se tocó en este PATCH: no se informa un "anterior" para él.
        assert cuerpo["overlap_minimo_anterior"] is None

    def test_get_no_lleva_los_campos_anterior(self, client, como, crear_configuracion):
        crear_configuracion()
        como("mozo")
        assert "confirmacion_segundos_anterior" not in client.get("/configuracion").json()

    @pytest.mark.parametrize("valor", [0, -1])
    def test_confirmacion_segundos_no_positiva_da_422(self, client, como, crear_configuracion, valor):
        crear_configuracion()
        como("admin")
        assert client.patch("/configuracion", json={"confirmacion_segundos": valor}).status_code == 422

    @pytest.mark.parametrize("valor", [0, -0.1, 1.5])
    def test_overlap_minimo_fuera_de_rango_da_422(self, client, como, crear_configuracion, valor):
        crear_configuracion()
        como("admin")
        assert client.patch("/configuracion", json={"overlap_minimo": valor}).status_code == 422

    def test_overlap_minimo_limite_superior_es_valido(self, client, como, crear_configuracion):
        crear_configuracion()
        como("admin")
        assert client.patch("/configuracion", json={"overlap_minimo": 1}).status_code == 200
