# Pruebas de app.utils.rtsp_url: completar la contraseña que la API no entrega,
# y tapar la que sí tenemos antes de escribirla en un log.

import pytest

from app.utils.rtsp_url import con_password, enmascarar, tiene_password_enmascarada

ENMASCARADA = "rtsp://admin:***@192.168.1.11:554/h264_hd.sdp"


class TestTienePasswordEnmascarada:
    def test_url_tal_como_la_devuelve_la_api(self):
        assert tiene_password_enmascarada(ENMASCARADA) is True

    def test_url_con_password_real(self):
        assert tiene_password_enmascarada("rtsp://admin:secreta@h:554/x") is False

    def test_url_sin_credenciales(self):
        assert tiene_password_enmascarada("rtsp://192.168.1.11:554/x") is False

    def test_url_sin_host(self):
        with pytest.raises(ValueError):
            tiene_password_enmascarada("no-es-una-url")


class TestConPassword:
    def test_reemplaza_la_password_enmascarada(self):
        assert con_password(ENMASCARADA, "roma241905") == (
            "rtsp://admin:roma241905@192.168.1.11:554/h264_hd.sdp"
        )

    def test_conserva_puerto_y_ruta(self):
        assert con_password("rtsp://admin:***@127.0.0.1:8554/stream1?x=1", "p") == (
            "rtsp://admin:p@127.0.0.1:8554/stream1?x=1"
        )

    def test_codifica_los_caracteres_que_partirian_la_url(self):
        # Una contraseña con @ o : rompería el netloc si se pegara tal cual.
        assert con_password(ENMASCARADA, "pa@ss:word/1") == (
            "rtsp://admin:pa%40ss%3Aword%2F1@192.168.1.11:554/h264_hd.sdp"
        )

    def test_no_toca_el_usuario_que_viene_codificado(self):
        assert con_password("rtsp://mi%40user:***@h:554/x", "p") == "rtsp://mi%40user:p@h:554/x"

    def test_url_sin_usuario(self):
        with pytest.raises(ValueError, match="no tiene usuario"):
            con_password("rtsp://192.168.1.11:554/x", "p")


class TestEnmascarar:
    def test_tapa_la_password(self):
        assert enmascarar("rtsp://admin:secreta@192.168.1.11:554/x") == (
            "rtsp://admin:***@192.168.1.11:554/x"
        )

    def test_una_url_ya_enmascarada_queda_igual(self):
        assert enmascarar(ENMASCARADA) == ENMASCARADA

    def test_url_sin_credenciales_queda_igual(self):
        assert enmascarar("rtsp://192.168.1.11:554/x") == "rtsp://192.168.1.11:554/x"

    @pytest.mark.parametrize("fuente", [0, 1, "data/samples/salon.mp4", "config/frame.png"])
    def test_las_fuentes_que_no_son_urls_pasan_tal_cual(self, fuente):
        # VIDEO_SOURCE puede ser un índice de webcam o una ruta de archivo.
        assert enmascarar(fuente) == str(fuente)

    def test_una_url_rota_con_credenciales_igual_se_tapa(self):
        # Ante la duda se tapa de más: en un log no puede quedar el secreto.
        assert "secreta" not in enmascarar("rtsp://admin:secreta@")
