# Captura de frames de la cámara.
# Aísla al resto del módulo de la fuente concreta: webcam, imagen estática,
# archivo de video o stream RTSP se consumen todos a través de la misma interfaz.

import os
import threading
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
        self._hilo = None
        self._detener = threading.Event()
        self._lock = threading.Lock()
        self._ultimo_frame = None

    def open(self):
        # Abre la fuente y valida que responda. Una imagen se lee una sola vez
        # con cv2.imread; webcam, video y RTSP se abren con cv2.VideoCapture.
        if self.tipo == IMAGEN:
            self._imagen = cv2.imread(str(self.source))
            if self._imagen is None:
                raise RuntimeError(f"No se pudo leer la imagen: {self.source}")
            logger.info("Fuente de imagen abierta: %s", self.source)
            return

        if self.tipo == RTSP:
            # El hilo de lectura (más abajo) ya evita que se acumulen frames sin
            # consumir del lado de la aplicación, pero FFmpeg puede sumar su
            # propio buffer/jitter interno antes de eso. `nobuffer`/`low_delay`
            # le piden que no lo arme, y BUFFERSIZE=1 es un pedido equivalente
            # para los backends que sí lo respetan (FFmpeg típicamente lo
            # ignora, pero no hace daño dejarlo).
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;0"
            )

        self.capture = cv2.VideoCapture(self.source)
        if not self.capture.isOpened():
            raise RuntimeError(f"No se pudo abrir la fuente de video ({self.tipo}): {self.source}")
        logger.info("Fuente de video abierta (%s): %s", self.tipo, self.source)

        if self.tipo == RTSP:
            self.capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            self._iniciar_hilo_lectura()

    def _iniciar_hilo_lectura(self):
        # Un stream RTSP produce frames en tiempo real, más rápido de lo que
        # el pipeline los consume (FRAME_INTERVAL_SECONDS, típicamente 2s).
        # Si se lee con un solo .read() por ciclo, cv2 va encolando los frames
        # que no se piden y cada lectura devuelve uno más viejo que el
        # anterior: el delay crece sin límite y termina viéndose "trancado".
        # Este hilo drena el stream sin parar y se queda solo con el último
        # frame, para que read_frame() siempre entregue el más reciente aunque
        # eso implique descartar los que quedan en el medio.
        self._detener.clear()
        self._hilo = threading.Thread(target=self._leer_continuamente, daemon=True)
        self._hilo.start()

    def _leer_continuamente(self):
        while not self._detener.is_set():
            try:
                ok, frame = self.capture.read()
            except Exception as error:
                logger.warning("Fallo leyendo el stream en el hilo de captura: %s", error)
                self._detener.wait(0.5)
                continue
            if not ok:
                self._detener.wait(0.05)
                continue
            with self._lock:
                self._ultimo_frame = frame

    def read_frame(self):
        # Devuelve el frame más reciente como array BGR, o None si todavía no
        # hay uno (RTSP recién abierto) o la fuente terminó. Una imagen
        # estática no tiene "próximo" frame: se repite en cada llamada,
        # simulando una cámara fija sobre una escena congelada.
        if self.tipo == IMAGEN:
            return None if self._imagen is None else self._imagen.copy()

        if self.tipo == RTSP:
            with self._lock:
                return self._ultimo_frame

        ok, frame = self.capture.read()
        return frame if ok else None

    def release(self):
        # Libera la fuente de video y, si había, el hilo de lectura continua.
        self._detener.set()
        if self._hilo is not None:
            self._hilo.join(timeout=2)
            self._hilo = None
        if self.capture is not None:
            self.capture.release()
            self.capture = None
        self._imagen = None
        self._ultimo_frame = None
