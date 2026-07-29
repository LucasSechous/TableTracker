# Punto de entrada del módulo de visión.
# Orquesta el pipeline: captura de frames -> detección YOLO -> mapeo a mesas ->
# envío del estado a la API de TableTracker.

from app import config
from app.utils.logger import get_logger

logger = get_logger(__name__)


def run():
    # Bucle principal del módulo. Pendiente de implementación:
    #   1. Abrir la fuente de video con capture.camera
    #   2. Por cada frame (cada FRAME_INTERVAL_SECONDS), detectar personas con detection.detector
    #   3. Resolver el estado de cada mesa con mapping.zonas
    #   4. Publicar los cambios con client.backend_client
    logger.info("Módulo de visión iniciado")
    logger.info("Fuente de video: %s", config.VIDEO_SOURCE)
    logger.info("Modelo YOLO: %s", config.YOLO_MODEL_PATH)
    logger.info("Backend: %s", config.BACKEND_URL)
    raise NotImplementedError("Pipeline pendiente de implementación (Sprint 5)")


if __name__ == "__main__":
    run()
