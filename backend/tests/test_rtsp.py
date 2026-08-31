# Prueba de conexión RTSP (T26-140): la parte de "12 chequeos de la sonda RTSP
# contra un servidor falso" de T26-126/T26-127.
#
# La mayoría corre directo contra app.services.rtsp.probar_conexion() con el
# servidor falso de fixtures/rtsp_fake_server.py — es lo mismo que ejercita el
# endpoint, más rápido de escribir y de correr sin pasar por HTTP. Los tests del
# final sí van por HTTP, contra los dos endpoints que envuelven rtsp.probar_url()/
# probar_conexion(): POST /camaras/{id}/test-conexion (sobre una cámara guardada,
# T26-126) y POST /camaras/test-conexion (con la URL en el body, sin persistir
# nada, T26-142) — para probar que el router arma bien la respuesta.

import socket

import pytest

from app.models.camara import Camara
from app.services import rtsp
from fixtures.rtsp_fake_server import (
    ServidorRtspFalso,
    escenario_401_sin_desafio,
    escenario_basic,
    escenario_codigo_fijo,
    escenario_cuelga,
    escenario_digest,
    escenario_esquema_no_soportado,
    escenario_no_habla_rtsp,
    escenario_ok,
    escenario_recupera_tras_cerrar,
)

TIMEOUT_TEST = 1.5  # generoso para no ser flaky en una máquina cargada, corto para no volver la suite lenta


def test_conexion_correcta_sin_credenciales():
    with ServidorRtspFalso(escenario_ok()) as servidor:
        resultado = rtsp.probar_conexion(servidor.host, servidor.puerto, "/s", timeout=TIMEOUT_TEST)
    assert resultado.ok is True
    assert resultado.codigo_rtsp == 200
    assert resultado.latencia_ms is not None


@pytest.mark.parametrize("con_qop", [False, True], ids=["sin_qop", "con_qop"])
def test_digest_con_password_correcta(con_qop):
    with ServidorRtspFalso(escenario_digest("admin", "s3cr3t0", con_qop=con_qop)) as servidor:
        resultado = rtsp.probar_conexion(
            servidor.host, servidor.puerto, "/s", "admin", "s3cr3t0", timeout=TIMEOUT_TEST
        )
    assert resultado.ok is True
    assert resultado.codigo_rtsp == 200


def test_digest_con_password_incorrecta():
    with ServidorRtspFalso(escenario_digest("admin", "s3cr3t0", con_qop=False)) as servidor:
        resultado = rtsp.probar_conexion(
            servidor.host, servidor.puerto, "/s", "admin", "otraclave", timeout=TIMEOUT_TEST
        )
    assert resultado.ok is False
    assert resultado.codigo_rtsp == 401
    assert "incorrectas" in resultado.mensaje


def test_basic_con_password_correcta():
    with ServidorRtspFalso(escenario_basic("admin", "s3cr3t0")) as servidor:
        resultado = rtsp.probar_conexion(
            servidor.host, servidor.puerto, "/s", "admin", "s3cr3t0", timeout=TIMEOUT_TEST
        )
    assert resultado.ok is True


def test_pide_auth_sin_usuario_configurado():
    with ServidorRtspFalso(escenario_digest("admin", "s3cr3t0", con_qop=False)) as servidor:
        resultado = rtsp.probar_conexion(servidor.host, servidor.puerto, "/s", timeout=TIMEOUT_TEST)
    assert resultado.ok is False
    assert resultado.codigo_rtsp == 401
    assert "no tiene usuario configurado" in resultado.mensaje


def test_esquema_de_auth_no_soportado():
    with ServidorRtspFalso(escenario_esquema_no_soportado("NTLM")) as servidor:
        resultado = rtsp.probar_conexion(
            servidor.host, servidor.puerto, "/s", "admin", "x", timeout=TIMEOUT_TEST
        )
    assert resultado.ok is False
    assert "NTLM" in resultado.mensaje


def test_401_sin_cabecera_de_desafio():
    with ServidorRtspFalso(escenario_401_sin_desafio()) as servidor:
        resultado = rtsp.probar_conexion(
            servidor.host, servidor.puerto, "/s", "admin", "x", timeout=TIMEOUT_TEST
        )
    assert resultado.ok is False
    assert resultado.codigo_rtsp == 401
    assert "sin indicar cómo autenticarse" in resultado.mensaje


def test_404():
    with ServidorRtspFalso(escenario_codigo_fijo(404)) as servidor:
        resultado = rtsp.probar_conexion(servidor.host, servidor.puerto, "/no-existe", timeout=TIMEOUT_TEST)
    assert resultado.ok is False
    assert resultado.codigo_rtsp == 404
    assert "ruta" in resultado.mensaje


def test_codigo_sin_mensaje_mapeado_usa_la_razon_del_servidor():
    with ServidorRtspFalso(escenario_codigo_fijo(500, "Internal Server Error")) as servidor:
        resultado = rtsp.probar_conexion(servidor.host, servidor.puerto, "/s", timeout=TIMEOUT_TEST)
    assert resultado.ok is False
    assert resultado.codigo_rtsp == 500
    assert "Internal Server Error" in resultado.mensaje


def test_algo_escucha_pero_no_habla_rtsp():
    with ServidorRtspFalso(escenario_no_habla_rtsp()) as servidor:
        resultado = rtsp.probar_conexion(servidor.host, servidor.puerto, "/s", timeout=TIMEOUT_TEST)
    assert resultado.ok is False
    assert "no habla RTSP" in resultado.mensaje


def test_se_recupera_si_la_primera_conexion_se_cierra():
    with ServidorRtspFalso(escenario_recupera_tras_cerrar()) as servidor:
        resultado = rtsp.probar_conexion(servidor.host, servidor.puerto, "/s", timeout=TIMEOUT_TEST)
    assert resultado.ok is True


def test_puerto_cerrado(monkeypatch):
    # Por monkeypatch y no contra un puerto real cerrado: en Windows, conectar a
    # un puerto que nadie escucha en 127.0.0.1 no siempre da ECONNREFUSED al
    # toque — depende del firewall, y en la práctica se vio caer directo en el
    # camino de timeout en vez del de "rechazó la conexión". Ese timeout ya lo
    # cubre test_timeout(); esto prueba el mensaje específico de forma
    # determinística, sin depender de cómo responda la pila TCP de turno.
    def _rechaza(*_args, **_kwargs):
        raise ConnectionRefusedError()

    monkeypatch.setattr(socket, "create_connection", _rechaza)
    resultado = rtsp.probar_conexion("127.0.0.1", 1, "/s", timeout=TIMEOUT_TEST)
    assert resultado.ok is False
    assert "rechazó la conexión" in resultado.mensaje


def test_timeout():
    with ServidorRtspFalso(escenario_cuelga(duracion_segundos=TIMEOUT_TEST + 1)) as servidor:
        resultado = rtsp.probar_conexion(servidor.host, servidor.puerto, "/s", timeout=0.4)
    assert resultado.ok is False
    assert "no respondió" in resultado.mensaje


def test_host_no_resuelve(monkeypatch):
    def _falla(*_args, **_kwargs):
        raise socket.gaierror("no address associated with hostname")

    monkeypatch.setattr(socket, "create_connection", _falla)
    resultado = rtsp.probar_conexion("host-que-no-existe.invalido", 554, "/s", timeout=TIMEOUT_TEST)
    assert resultado.ok is False
    assert "no se pudo resolver" in resultado.mensaje.lower()


@pytest.mark.parametrize(
    "url",
    ["no-es-una-url", "http://10.0.0.1/s", "rtsp://", "rtsp://host:puerto-no-numerico/s"],
)
def test_parsear_url_invalida(url):
    with pytest.raises(ValueError):
        rtsp.parsear_url(url)


def test_probar_url_con_url_invalida_no_intenta_conectar():
    resultado = rtsp.probar_url("no-es-una-url")
    assert resultado.ok is False
    assert "no es válida" in resultado.mensaje


# --------------------------------------------------------------- vía el router

def test_endpoint_test_conexion_ok(client, como, crear_camara):
    with ServidorRtspFalso(escenario_ok()) as servidor:
        camara = crear_camara(rtsp_url=f"rtsp://{servidor.host}:{servidor.puerto}/s")
        como("admin")
        respuesta = client.post(
            f"/camaras/{camara.id}/test-conexion", params={"timeout_segundos": TIMEOUT_TEST}
        )
    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["ok"] is True
    assert cuerpo["codigo_rtsp"] == 200
    assert "***" not in cuerpo["rtsp_url"] or camara.password is None  # sin credenciales, no hay nada que tapar


def test_endpoint_test_conexion_credenciales_incorrectas(client, como, crear_camara):
    with ServidorRtspFalso(escenario_digest("admin", "correcta", con_qop=False)) as servidor:
        camara = crear_camara(rtsp_url=f"rtsp://admin:incorrecta@{servidor.host}:{servidor.puerto}/s")
        como("admin")
        respuesta = client.post(
            f"/camaras/{camara.id}/test-conexion", params={"timeout_segundos": TIMEOUT_TEST}
        )
    assert respuesta.status_code == 200  # test-conexion siempre responde 200: el diagnóstico va en el cuerpo
    cuerpo = respuesta.json()
    assert cuerpo["ok"] is False
    assert cuerpo["codigo_rtsp"] == 401
    assert "***" in cuerpo["rtsp_url"]  # la URL en la respuesta nunca lleva la contraseña real


def test_endpoint_test_conexion_404(client, como):
    como("admin")
    assert client.post("/camaras/9999/test-conexion").status_code == 404


@pytest.mark.parametrize("timeout", [0, 16])
def test_endpoint_test_conexion_timeout_fuera_de_rango(client, como, crear_camara, timeout):
    camara = crear_camara()
    como("admin")
    respuesta = client.post(f"/camaras/{camara.id}/test-conexion", params={"timeout_segundos": timeout})
    assert respuesta.status_code == 422


# ------------------------------------------------- vía el router, sin {camara_id}

def test_endpoint_test_conexion_url_ok(client, como):
    with ServidorRtspFalso(escenario_ok()) as servidor:
        como("admin")
        respuesta = client.post(
            "/camaras/test-conexion",
            json={"rtsp_url": f"rtsp://{servidor.host}:{servidor.puerto}/s"},
            params={"timeout_segundos": TIMEOUT_TEST},
        )
    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["ok"] is True
    assert cuerpo["codigo_rtsp"] == 200


def test_endpoint_test_conexion_url_no_persiste_nada(client, como, db):
    with ServidorRtspFalso(escenario_ok()) as servidor:
        como("admin")
        client.post(
            "/camaras/test-conexion",
            json={"rtsp_url": f"rtsp://admin:s3cr3t0@{servidor.host}:{servidor.puerto}/s"},
            params={"timeout_segundos": TIMEOUT_TEST},
        )
    assert db.query(Camara).count() == 0


def test_endpoint_test_conexion_url_tapa_la_password_en_la_respuesta(client, como):
    with ServidorRtspFalso(escenario_digest("admin", "correcta", con_qop=False)) as servidor:
        como("admin")
        respuesta = client.post(
            "/camaras/test-conexion",
            json={"rtsp_url": f"rtsp://admin:incorrecta@{servidor.host}:{servidor.puerto}/s"},
            params={"timeout_segundos": TIMEOUT_TEST},
        )
    assert respuesta.status_code == 200  # mismo contrato que el endpoint con {camara_id}: 200 con ok=False
    cuerpo = respuesta.json()
    assert cuerpo["ok"] is False
    assert cuerpo["codigo_rtsp"] == 401
    assert "incorrecta" not in cuerpo["rtsp_url"]
    assert "***" in cuerpo["rtsp_url"]


def test_endpoint_test_conexion_url_invalida_da_200_con_ok_false(client, como):
    como("admin")
    respuesta = client.post("/camaras/test-conexion", json={"rtsp_url": "no-es-una-url"})
    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["ok"] is False
    assert "no es válida" in cuerpo["mensaje"]


def test_endpoint_test_conexion_url_vacia_da_422(client, como):
    como("admin")
    assert client.post("/camaras/test-conexion", json={"rtsp_url": ""}).status_code == 422


def test_endpoint_test_conexion_url_sin_body_da_422(client, como):
    como("admin")
    assert client.post("/camaras/test-conexion", json={}).status_code == 422
