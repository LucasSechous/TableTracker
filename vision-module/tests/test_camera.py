# Pruebas de app.capture.camera: clasificación de la fuente y ciclo de vida
# de Camera (open/read_frame/release) para cada tipo soportado.

import time
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.capture.camera import Camera, IMAGEN, RTSP, VIDEO, WEBCAM, tipo_de_fuente


class TestTipoDeFuente:
    def test_indice_entero_es_webcam(self):
        assert tipo_de_fuente(0) == WEBCAM
        assert tipo_de_fuente(1) == WEBCAM

    @pytest.mark.parametrize("url", ["rtsp://host/stream", "RTSP://host/stream", "rtsps://host/stream"])
    def test_url_rtsp(self, url):
        assert tipo_de_fuente(url) == RTSP

    @pytest.mark.parametrize("ruta", ["foto.jpg", "foto.PNG", "carpeta/foto.bmp"])
    def test_archivo_imagen(self, ruta):
        assert tipo_de_fuente(ruta) == IMAGEN

    @pytest.mark.parametrize("ruta", ["video.mp4", "video.AVI", "carpeta/video.mkv"])
    def test_archivo_video(self, ruta):
        assert tipo_de_fuente(ruta) == VIDEO

    def test_extension_desconocida_lanza_error(self):
        with pytest.raises(ValueError):
            tipo_de_fuente("archivo.txt")


class TestCameraImagen:
    def _crear_imagen(self, tmp_path):
        import cv2

        ruta = tmp_path / "frame.png"
        cv2.imwrite(str(ruta), np.zeros((10, 10, 3), dtype=np.uint8))
        return ruta

    def test_read_frame_devuelve_la_misma_imagen_repetidamente(self, tmp_path):
        ruta = self._crear_imagen(tmp_path)
        camara = Camera(str(ruta))
        camara.open()

        primero = camara.read_frame()
        segundo = camara.read_frame()

        assert primero is not None
        assert np.array_equal(primero, segundo)
        assert primero is not segundo  # cada llamada devuelve una copia

    def test_release_hace_que_read_frame_devuelva_none(self, tmp_path):
        ruta = self._crear_imagen(tmp_path)
        camara = Camera(str(ruta))
        camara.open()
        camara.release()

        assert camara.read_frame() is None

    def test_open_con_imagen_inexistente_lanza_error(self, tmp_path):
        camara = Camera(str(tmp_path / "no_existe.jpg"))
        with pytest.raises(RuntimeError):
            camara.open()


class TestCameraVideoCapture:
    # Cubre webcam, video y RTSP: los tres se abren con cv2.VideoCapture,
    # que se mockea para no depender de hardware ni archivos reales.

    @pytest.mark.parametrize("source", [0, "video.mp4", "rtsp://host/stream"])
    def test_open_valida_que_la_fuente_haya_abierto(self, source):
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = False
        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera(source)
            with pytest.raises(RuntimeError):
                camara.open()

    def test_read_frame_devuelve_el_frame_cuando_hay_uno(self):
        frame_esperado = np.ones((5, 5, 3), dtype=np.uint8)
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        mock_capture.read.return_value = (True, frame_esperado)

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera(0)
            camara.open()
            assert np.array_equal(camara.read_frame(), frame_esperado)

    def test_read_frame_devuelve_none_cuando_la_fuente_termino(self):
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        mock_capture.read.return_value = (False, None)

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera("video.mp4")
            camara.open()
            assert camara.read_frame() is None

    def test_release_libera_el_capture(self):
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera("rtsp://host/stream")
            camara.open()
            camara.release()

        mock_capture.release.assert_called_once()
        assert camara.capture is None

    def test_rtsp_entrega_siempre_el_ultimo_frame_y_no_uno_encolado(self):
        # El hilo de captura drena el stream sin parar: aunque el mock genere
        # frames más rápido de lo que el test los pide, read_frame() nunca
        # debería devolver uno viejo (el bug que esto reemplaza: cv2 sin
        # drenar iba acumulando delay).
        frames = [np.full((2, 2, 3), i, dtype=np.uint8) for i in range(5)]
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        mock_capture.read.side_effect = [(True, f) for f in frames] + [(True, frames[-1])] * 1000

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera("rtsp://host/stream")
            camara.open()
            try:
                # Le da tiempo al hilo a consumir de sobra los 5 frames iniciales.
                for _ in range(20):
                    if camara.read_frame() is not None:
                        break
                    time.sleep(0.01)
                time.sleep(0.1)
                assert np.array_equal(camara.read_frame(), frames[-1])
            finally:
                camara.release()

    def test_rtsp_no_arranca_hilo_para_video_o_webcam(self):
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        mock_capture.read.return_value = (True, np.zeros((2, 2, 3), dtype=np.uint8))

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera("video.mp4")
            camara.open()
            assert camara._hilo is None
            camara.release()


class TestCameraNoFiltraCredenciales:
    # rtsp_url.enmascarar() existe justamente para que la contraseña de la cámara no
    # salga nunca al log, y su docstring lo pide explícitamente. camera.py era el único
    # punto que la escribía en claro: en el log de "Fuente de video abierta" y, peor,
    # en el RuntimeError de fallo de apertura, que además termina en el traceback.
    URL = "rtsp://Camara:secreta123@192.168.1.38:554/stream1"

    def test_el_error_de_apertura_no_lleva_la_password(self):
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = False

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera(self.URL)
            with pytest.raises(RuntimeError) as excinfo:
                camara.open()

        assert "secreta123" not in str(excinfo.value)
        assert "***" in str(excinfo.value)
        # El resto de la URL sí tiene que estar: sin host no se puede diagnosticar nada.
        assert "192.168.1.38" in str(excinfo.value)

    def test_el_log_de_apertura_no_lleva_la_password(self, caplog):
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        mock_capture.read.return_value = (True, np.zeros((2, 2, 3), dtype=np.uint8))

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            with caplog.at_level("INFO"):
                camara = Camera(self.URL)
                camara.open()
                camara.release()

        assert "secreta123" not in caplog.text
        assert "192.168.1.38" in caplog.text

    def test_una_fuente_sin_credenciales_se_loguea_tal_cual(self, caplog):
        # Un índice de webcam o una ruta de archivo no tienen nada que tapar.
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        mock_capture.read.return_value = (True, np.zeros((2, 2, 3), dtype=np.uint8))

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            with caplog.at_level("INFO"):
                camara = Camera("video.mp4")
                camara.open()
                camara.release()

        assert "video.mp4" in caplog.text


class TestCameraStreamCaido:
    # Regresión de T26-177: el hilo lector solo pisa _ultimo_frame cuando la lectura
    # sale bien, así que un stream que se muere en caliente dejaba a read_frame()
    # devolviendo la última imagen buena PARA SIEMPRE. El bucle nunca veía un None,
    # el contador de frames fallidos nunca subía y reconectar() no se llamaba jamás:
    # el módulo seguía "detectando" sobre una foto congelada.

    @staticmethod
    def _camara_con_un_frame(antiguedad_maxima):
        """Abre una Camera RTSP que entrega un frame y después deja de entregar."""
        frame = np.full((2, 2, 3), 7, dtype=np.uint8)
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        # Un solo frame bueno y después siempre fallo: es lo que hace un stream que
        # se corta, no un archivo que termina.
        mock_capture.read.side_effect = [(True, frame)] + [(False, None)] * 100_000

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera("rtsp://host/stream", antiguedad_maxima=antiguedad_maxima)
            camara.open()
        return camara, frame

    def test_devuelve_el_frame_mientras_esta_fresco(self):
        camara, frame = self._camara_con_un_frame(antiguedad_maxima=5.0)
        try:
            for _ in range(50):
                if camara.read_frame() is not None:
                    break
                time.sleep(0.01)
            assert np.array_equal(camara.read_frame(), frame)
        finally:
            camara.release()

    def test_devuelve_none_cuando_el_frame_supera_la_antiguedad_maxima(self):
        # Umbral muy corto para no tener que esperar en el test.
        camara, _ = self._camara_con_un_frame(antiguedad_maxima=0.15)
        try:
            for _ in range(50):
                if camara.read_frame() is not None:
                    break
                time.sleep(0.01)
            assert camara.read_frame() is not None, "el frame inicial tendría que estar fresco"

            time.sleep(0.25)
            assert camara.read_frame() is None, "un frame vencido tiene que leerse como stream caído"
        finally:
            camara.release()

    def test_sin_ningun_frame_todavia_devuelve_none(self):
        # RTSP recién abierto: el hilo todavía no capturó nada. No hay timestamp que
        # comparar y no debe romper.
        mock_capture = MagicMock()
        mock_capture.isOpened.return_value = True
        mock_capture.read.return_value = (False, None)

        with patch("app.capture.camera.cv2.VideoCapture", return_value=mock_capture):
            camara = Camera("rtsp://host/stream")
            camara.open()
            try:
                assert camara.read_frame() is None
            finally:
                camara.release()

    def test_el_bucle_reconecta_cuando_el_stream_se_congela(self):
        # La consecuencia que importa: con el frame vencido, el bucle tiene que llegar
        # a reconectar(). Antes de T26-177 este camino era inalcanzable.
        from app import main

        video = MagicMock()
        video.read_frame.return_value = None  # stream caído

        reconexiones = []

        def fake_reconectar(v):
            reconexiones.append(v)
            raise KeyboardInterrupt  # corta el bucle infinito una vez probado el punto

        with patch.object(main, "reconectar", side_effect=fake_reconectar), patch.object(
            main, "esperar_proximo_frame", lambda _inicio: None
        ), patch.object(main.config, "FRAMES_FALLIDOS_MAXIMOS", 3):
            with pytest.raises(KeyboardInterrupt):
                main.bucle(video, MagicMock(), MagicMock(), [], MagicMock(), camara_id=5)

        assert len(reconexiones) == 1
        # Exactamente FRAMES_FALLIDOS_MAXIMOS lecturas antes de reconectar.
        assert video.read_frame.call_count == 3
