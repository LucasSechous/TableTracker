# Captura de frames de la cámara.
# Aísla al resto del módulo de la fuente concreta: webcam, archivo de video o
# stream RTSP se consumen todos a través de la misma interfaz.

from app.utils.logger import get_logger

logger = get_logger(__name__)


class Camera:
    # source: índice de webcam, ruta de archivo o URL RTSP (ver config.VIDEO_SOURCE)
    def __init__(self, source):
        self.source = source
        self.capture = None

    def open(self):
        # Abre la fuente con cv2.VideoCapture y valida que responda.
        raise NotImplementedError

    def read_frame(self):
        # Devuelve el próximo frame como array BGR, o None si la fuente terminó.
        raise NotImplementedError

    def release(self):
        # Libera la fuente de video.
        raise NotImplementedError
