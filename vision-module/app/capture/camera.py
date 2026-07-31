# Captura de frames de la cámara.
# Aísla al resto del módulo de la fuente concreta: webcam, imagen estática,
# archivo de video o stream RTSP se consumen todos a través de la misma interfaz.

from pathlib import Path

import cv2

from app.utils.logger import get_logger

logger = get_logger(__name__)

# Tipos de fuente soportados (ver config.VIDEO_SOURCE)
WEBCAM = "webcam"
IMAGEN = "imagen"
VIDEO = "video"
RTSP = "rtsp"

_EXTENSIONES_IMAGEN = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
_EXTENSIONES_VIDEO = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv", ".wmv"}
_PREFIJOS_RTSP = ("rtsp://", "rtsps://")


def tipo_de_fuente(source):
    # Clasifica el origen para decidir cómo abrirlo. Un entero es índice de
    # webcam; el resto se clasifica por prefijo (RTSP) o extensión de archivo.
    if isinstance(source, int):
        return WEBCAM

    texto = str(source)
    if texto.lower().startswith(_PREFIJOS_RTSP):
        return RTSP

    extension = Path(texto).suffix.lower()
    if extension in _EXTENSIONES_IMAGEN:
        return IMAGEN
    if extension in _EXTENSIONES_VIDEO:
        return VIDEO

    raise ValueError(f"No se pudo determinar el tipo de fuente para: {source!r}")


class Camera:
    # source: índice de webcam, ruta de archivo (imagen o video) o URL RTSP
    # (ver config.VIDEO_SOURCE)
    def __init__(self, source):
        self.source = source
        self.tipo = tipo_de_fuente(source)
        self.capture = None
        self._imagen = None

    def open(self):
        # Abre la fuente y valida que responda. Una imagen se lee una sola vez
        # con cv2.imread; webcam, video y RTSP se abren con cv2.VideoCapture.
        if self.tipo == IMAGEN:
            self._imagen = cv2.imread(str(self.source))
            if self._imagen is None:
                raise RuntimeError(f"No se pudo leer la imagen: {self.source}")
            logger.info("Fuente de imagen abierta: %s", self.source)
            return

        self.capture = cv2.VideoCapture(self.source)
        if not self.capture.isOpened():
            raise RuntimeError(f"No se pudo abrir la fuente de video ({self.tipo}): {self.source}")
        logger.info("Fuente de video abierta (%s): %s", self.tipo, self.source)

    def read_frame(self):
        # Devuelve el próximo frame como array BGR, o None si la fuente terminó.
        # Una imagen estática no tiene "próximo" frame: se repite en cada
        # llamada, simulando una cámara fija sobre una escena congelada.
        if self.tipo == IMAGEN:
            return None if self._imagen is None else self._imagen.copy()

        ok, frame = self.capture.read()
        return frame if ok else None

    def release(self):
        # Libera la fuente de video.
        if self.capture is not None:
            self.capture.release()
            self.capture = None
        self._imagen = None
