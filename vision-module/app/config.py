# Configuración del módulo de visión.
# Centraliza la lectura de variables de entorno para que el resto del módulo
# no dependa de os.getenv ni de rutas relativas al directorio de ejecución.

from pathlib import Path
from dotenv import load_dotenv
import os

# Raíz de vision-module/, para resolver rutas relativas del .env
BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def ruta(valor, defecto):
    # Convierte una ruta del .env en absoluta, tomando BASE_DIR como origen.
    return (BASE_DIR / os.getenv(valor, defecto)).resolve()


# Fuente de video: índice de webcam si es numérico, si no ruta de archivo o URL RTSP
VIDEO_SOURCE = os.getenv("VIDEO_SOURCE", "0")
if VIDEO_SOURCE.isdigit():
    VIDEO_SOURCE = int(VIDEO_SOURCE)

# Detección
YOLO_MODEL_PATH = ruta("YOLO_MODEL_PATH", "models/yolov8n.pt")
YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.5"))
YOLO_CLASSES = [int(c) for c in os.getenv("YOLO_CLASSES", "0").split(",") if c.strip()]

# Cadencia del pipeline
FRAME_INTERVAL_SECONDS = float(os.getenv("FRAME_INTERVAL_SECONDS", "2"))

# Mapa de zonas (ROI) por mesa
ZONES_FILE = ruta("ZONES_FILE", "config/zonas.json")

# API de TableTracker
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
BACKEND_TOKEN = os.getenv("BACKEND_TOKEN")

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
