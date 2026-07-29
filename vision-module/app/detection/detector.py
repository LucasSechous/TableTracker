# Wrapper del modelo YOLO (ultralytics).
# Recibe un frame y devuelve las detecciones filtradas por clase y confianza,
# de modo que el resto del módulo no dependa de la API de ultralytics.

from app.utils.logger import get_logger

logger = get_logger(__name__)


class Deteccion:
    # Una detección individual: caja en píxeles (x1, y1, x2, y2), clase y confianza.
    def __init__(self, bbox, clase, confianza):
        self.bbox = bbox
        self.clase = clase
        self.confianza = confianza

    @property
    def centro(self):
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2, (y1 + y2) / 2)


class Detector:
    def __init__(self, model_path, confidence, classes):
        self.model_path = model_path
        self.confidence = confidence
        self.classes = classes
        self.model = None

    def load(self):
        # Carga los pesos YOLO una sola vez (ultralytics.YOLO).
        raise NotImplementedError

    def detect(self, frame):
        # Ejecuta la inferencia sobre un frame y devuelve una lista de Deteccion.
        raise NotImplementedError
