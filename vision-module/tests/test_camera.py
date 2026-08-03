# Pruebas de app.capture.camera: clasificación de la fuente y ciclo de vida
# de Camera (open/read_frame/release) para cada tipo soportado.

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
