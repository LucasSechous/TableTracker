# Pruebas de app.detection.detector: carga del modelo y conversión de los
# resultados de ultralytics a Deteccion. Se mockea ultralytics.YOLO para no
# depender de pesos reales ni de tiempo de inferencia.

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.detection.detector import Deteccion, Detector


class FakeCaja:
    # Emula una Boxes de ultralytics ya indexada a una sola detección.
    def __init__(self, bbox, clase, confianza):
        self.xyxy = [np.array(bbox, dtype=float)]
        self.cls = [clase]
        self.conf = [confianza]


def _resultado_con(cajas):
    return [SimpleNamespace(boxes=cajas)]


class TestDeteccion:
    def test_centro_es_el_punto_medio_del_bbox(self):
        deteccion = Deteccion((0, 0, 10, 20), clase=0, confianza=0.9)
        assert deteccion.centro == (5, 10)


class TestDetectorLoad:
    def test_load_instancia_yolo_con_la_ruta_del_modelo(self):
        with patch("app.detection.detector.YOLO") as mock_yolo:
            detector = Detector("models/yolov8n.pt", confidence=0.5, classes=[0])
            detector.load()

            mock_yolo.assert_called_once_with("models/yolov8n.pt")
            assert detector.model is mock_yolo.return_value


class TestDetectorDetect:
    def test_detect_sin_cargar_el_modelo_lanza_error(self):
        detector = Detector("models/yolov8n.pt", confidence=0.5, classes=[0])
        with pytest.raises(RuntimeError):
            detector.detect(frame=np.zeros((10, 10, 3)))

    def test_detect_convierte_las_cajas_a_deteccion(self):
        detector = Detector("models/yolov8n.pt", confidence=0.5, classes=[0])
        detector.model = MagicMock()
        detector.model.predict.return_value = _resultado_con(
            [
                FakeCaja((1, 2, 3, 4), clase=0, confianza=0.91),
                FakeCaja((5, 6, 7, 8), clase=0, confianza=0.77),
            ]
        )

        detecciones = detector.detect(frame=np.zeros((10, 10, 3)))

        assert len(detecciones) == 2
        assert detecciones[0].bbox == (1.0, 2.0, 3.0, 4.0)
        assert detecciones[0].clase == 0
        assert detecciones[0].confianza == pytest.approx(0.91)
        assert detecciones[1].bbox == (5.0, 6.0, 7.0, 8.0)

    def test_detect_sin_detecciones_devuelve_lista_vacia(self):
        detector = Detector("models/yolov8n.pt", confidence=0.5, classes=[0])
        detector.model = MagicMock()
        detector.model.predict.return_value = _resultado_con([])

        assert detector.detect(frame=np.zeros((10, 10, 3))) == []

    def test_detect_filtra_por_confianza_y_clases_en_la_inferencia(self):
        detector = Detector("models/yolov8n.pt", confidence=0.6, classes=[0, 2])
        detector.model = MagicMock()
        detector.model.predict.return_value = _resultado_con([])
        frame = np.zeros((10, 10, 3))

        detector.detect(frame)

        detector.model.predict.assert_called_once_with(
            frame, conf=0.6, classes=[0, 2], verbose=False
        )
