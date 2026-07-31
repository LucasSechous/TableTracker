# Wrapper del modelo YOLO (ultralytics).
# Recibe un frame y devuelve las detecciones filtradas por clase y confianza,
# de modo que el resto del módulo no dependa de la API de ultralytics.
# El modelo se carga una sola vez (load) y se reutiliza en cada detect(),
# sin importar de qué fuente de captura (T26-99) vengan los frames.

from ultralytics import YOLO

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
        self.model = YOLO(str(self.model_path))
        logger.info("Modelo YOLO cargado: %s", self.model_path)

    def detect(self, frame):
        # Ejecuta la inferencia sobre un frame y devuelve una lista de Deteccion.
        # La confianza y las clases se filtran en la propia inferencia para no
        # duplicar ese criterio en el resto del pipeline.
        if self.model is None:
            raise RuntimeError("El modelo no está cargado: llamar a load() antes de detect()")

        resultados = self.model.predict(
            frame,
            conf=self.confidence,
            classes=self.classes,
            verbose=False,
        )
        cajas = resultados[0].boxes
        return [
            Deteccion(tuple(caja.xyxy[0].tolist()), int(caja.cls[0]), float(caja.conf[0]))
            for caja in cajas
        ]
