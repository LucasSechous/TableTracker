# Pruebas de app.client.backend_client: autenticación, renovación del token al
# vencer y traducción de los errores de la API. Se mockea requests.Session para
# no necesitar un backend levantado.

from unittest.mock import MagicMock

import pytest
import requests

from app.client.backend_client import BackendClient, CredencialesInvalidas, ErrorBackend


def respuesta(status=200, cuerpo=None, texto=""):
    falsa = MagicMock()
    falsa.status_code = status
    falsa.ok = 200 <= status < 400
    falsa.json.return_value = {} if cuerpo is None else cuerpo
    falsa.text = texto
    return falsa


def cliente_con(*respuestas_de_request, respuesta_de_login=None):
    cliente = BackendClient("http://localhost:8000/", "vision@x.com", "clave", timeout=3)
    cliente.sesion = MagicMock()
    cliente.sesion.post.return_value = respuesta_de_login or respuesta(
        cuerpo={"access_token": "tok", "token_type": "bearer"}
    )
    cliente.sesion.request.side_effect = list(respuestas_de_request)
    return cliente


class TestLogin:
    def test_guarda_el_token(self):
        cliente = cliente_con()
        cliente.login()

        assert cliente.token == "tok"
        cliente.sesion.post.assert_called_once_with(
            "http://localhost:8000/auth/login",
            json={"email": "vision@x.com", "password": "clave"},
            timeout=3,
        )

    def test_credenciales_rechazadas(self):
        cliente = cliente_con(respuesta_de_login=respuesta(401))
        with pytest.raises(CredencialesInvalidas, match="BACKEND_EMAIL"):
            cliente.login()

    def test_rate_limit_del_backend(self):
        # /auth/login corta a los 5 intentos fallidos por minuto.
        cliente = cliente_con(respuesta_de_login=respuesta(429))
        with pytest.raises(ErrorBackend, match="limitando"):
            cliente.login()

    def test_backend_caido(self):
        cliente = cliente_con()
        cliente.sesion.post.side_effect = requests.ConnectionError("sin ruta al host")
        with pytest.raises(ErrorBackend, match="No se pudo contactar la API"):
            cliente.login()


class TestAutorizacion:
    def test_manda_el_token_en_cada_pedido(self):
        cliente = cliente_con(respuesta(cuerpo=[]))
        cliente.login()
        cliente.listar_camaras(sector_id=2)

        _, kwargs = cliente.sesion.request.call_args
        assert kwargs["headers"] == {"Authorization": "Bearer tok"}

    def test_un_401_renueva_el_token_y_reintenta(self):
        # El token del backend vence a los 30 minutos y el módulo corre siempre.
        cliente = cliente_con(respuesta(401), respuesta(cuerpo=[{"id": 2}]))
        cliente.login()

        assert cliente.listar_camaras() == [{"id": 2}]
        assert cliente.sesion.post.call_count == 2
        assert cliente.sesion.request.call_count == 2

    def test_un_401_que_persiste_no_reintenta_para_siempre(self):
        cliente = cliente_con(respuesta(401), respuesta(401))
        cliente.login()

        with pytest.raises(ErrorBackend):
            cliente.listar_camaras()
        assert cliente.sesion.request.call_count == 2

    def test_un_403_apunta_al_rol_del_usuario_tecnico(self):
        # /camaras y /roi-mesa son solo admin: es el bloqueo de T26-129.
        cliente = cliente_con(respuesta(403))
        cliente.login()

        with pytest.raises(CredencialesInvalidas, match="T26-129"):
            cliente.listar_rois(camara_id=2)


class TestEndpoints:
    def test_listar_camaras_filtra_por_sector(self):
        cliente = cliente_con(respuesta(cuerpo=[]))
        cliente.login()
        cliente.listar_camaras(sector_id=2)

        args, kwargs = cliente.sesion.request.call_args
        assert args == ("GET", "http://localhost:8000/camaras/")
        assert kwargs["params"] == {"sector_id": 2}

    def test_listar_camaras_sin_sector_no_manda_el_filtro(self):
        cliente = cliente_con(respuesta(cuerpo=[]))
        cliente.login()
        cliente.listar_camaras()

        assert cliente.sesion.request.call_args.kwargs["params"] == {}

    def test_listar_rois_filtra_por_camara(self):
        cliente = cliente_con(respuesta(cuerpo=[]))
        cliente.login()
        cliente.listar_rois(camara_id=2)

        args, kwargs = cliente.sesion.request.call_args
        assert args == ("GET", "http://localhost:8000/roi-mesa/")
        assert kwargs["params"] == {"camara_id": 2}

    def test_obtener_mesa(self):
        cliente = cliente_con(respuesta(cuerpo={"id": 221, "estado": "libre"}))
        cliente.login()

        assert cliente.obtener_mesa(221)["estado"] == "libre"
        assert cliente.sesion.request.call_args.args == ("GET", "http://localhost:8000/mesas/221")

    def test_cambiar_estado(self):
        cliente = cliente_con(respuesta(cuerpo={"id": 221, "estado": "ocupada"}))
        cliente.login()
        cliente.cambiar_estado(221, "ocupada")

        args, kwargs = cliente.sesion.request.call_args
        assert args == ("PATCH", "http://localhost:8000/mesas/221/estado")
        assert kwargs["json"] == {"estado": "ocupada"}

    def test_publicar_deteccion_actual(self):
        # 204 sin cuerpo: a diferencia de cambiar_estado, no hay .json() que leer
        # de la respuesta.
        cliente = cliente_con(respuesta(204))
        cliente.login()
        cliente.publicar_deteccion_actual(2, {"schema_version": "1.0"})

        args, kwargs = cliente.sesion.request.call_args
        assert args == ("POST", "http://localhost:8000/camaras/2/deteccion-actual")
        assert kwargs["json"] == {"schema_version": "1.0"}

    def test_el_detalle_del_error_llega_al_mensaje(self):
        cliente = cliente_con(respuesta(404, cuerpo={"detail": "Mesa no encontrada"}))
        cliente.login()

        with pytest.raises(ErrorBackend, match="Mesa no encontrada"):
            cliente.obtener_mesa(999)

    def test_un_error_sin_json_no_rompe_el_mensaje(self):
        sin_json = respuesta(500, texto="<html>Internal Server Error</html>")
        sin_json.json.side_effect = ValueError
        cliente = cliente_con(sin_json)
        cliente.login()

        with pytest.raises(ErrorBackend, match="Internal Server Error"):
            cliente.obtener_mesa(1)
