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


def entero(valor, defecto=None):
    # Variables que son ids del backend: vacías valen None, no 0.
    texto = os.getenv(valor, "").strip()
    return int(texto) if texto else defecto


# Fuente de video. Normalmente vacía: el stream sale de la cámara registrada en
# el backend (ver main.resolver_fuente). Sirve como override para desarrollo
# —webcam, un .mp4 de muestra, una imagen fija— y para scripts/test_condiciones.py,
# que la exige. Índice de webcam si es numérica, si no ruta de archivo o URL RTSP.
VIDEO_SOURCE = os.getenv("VIDEO_SOURCE", "").strip() or None
if VIDEO_SOURCE is not None and VIDEO_SOURCE.isdigit():
    VIDEO_SOURCE = int(VIDEO_SOURCE)

# Detección
YOLO_MODEL_PATH = ruta("YOLO_MODEL_PATH", "models/yolov8n.pt")
YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.5"))
YOLO_CLASSES = [int(c) for c in os.getenv("YOLO_CLASSES", "0").split(",") if c.strip()]

# Cadencia del pipeline
FRAME_INTERVAL_SECONDS = float(os.getenv("FRAME_INTERVAL_SECONDS", "2"))

# Sector piloto y cámara a procesar. Con una sola cámara activa en el sector
# alcanza con SECTOR_ID; si hay varias, CAMARA_ID desempata (ver main.seleccionar_camara).
SECTOR_ID = entero("SECTOR_ID")
CAMARA_ID = entero("CAMARA_ID")
# Contraseña del stream RTSP: la API la devuelve enmascarada, así que la pone el
# módulo (ver app/utils/rtsp_url.py).
CAMARA_PASSWORD = os.getenv("CAMARA_PASSWORD") or None

# Ocupación: qué fracción de un bounding box tiene que caer dentro del ROI para
# contar como una persona en esa mesa.
OVERLAP_MINIMO = float(os.getenv("OVERLAP_MINIMO", "0.30"))
# Cuánto tiene que sostenerse una observación antes de confirmar el cambio de
# estado. Evita que alguien que pasa caminando marque la mesa como ocupada.
CONFIRMACION_SEGUNDOS = float(os.getenv("CONFIRMACION_SEGUNDOS", "6"))

# Reconexión de la cámara: frames nulos seguidos que se toleran antes de cerrar
# y reabrir el stream, y espera entre intentos de reapertura.
FRAMES_FALLIDOS_MAXIMOS = int(os.getenv("FRAMES_FALLIDOS_MAXIMOS", "5"))
RECONEXION_SEGUNDOS = float(os.getenv("RECONEXION_SEGUNDOS", "5"))

# Cuántos intervalos de frame se toleran sin imagen NUEVA antes de dar el stream por
# caído (T26-177). Se expresa como múltiplo y no como una constante en segundos para
# que acompañe si se cambia la cadencia del pipeline.
#
# El hilo lector de Camera drena el stream a la velocidad de la cámara, así que en
# operación normal el último frame tiene decenas de milisegundos: cualquier valor por
# encima de un par de intervalos ya distingue "hipo momentáneo" de "stream muerto",
# sin producir reconexiones espurias.
INTERVALOS_TOLERADOS_SIN_FRAME = float(os.getenv("INTERVALOS_TOLERADOS_SIN_FRAME", "3"))
FRAME_ANTIGUEDAD_MAXIMA_SEGUNDOS = FRAME_INTERVAL_SECONDS * INTERVALOS_TOLERADOS_SIN_FRAME

# API de TableTracker. El módulo se loguea con su propio usuario (T26-129) en vez
# de llevar un token pegado en el .env: el token del backend vence a los 30 minutos.
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
BACKEND_EMAIL = os.getenv("BACKEND_EMAIL")
BACKEND_PASSWORD = os.getenv("BACKEND_PASSWORD")
BACKEND_TIMEOUT = float(os.getenv("BACKEND_TIMEOUT", "10"))

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
