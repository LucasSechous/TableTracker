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
#
# Los tres valores de abajo se eligieron midiendo (T26-178 / T26-179), no por defecto
# de la librería. El dato que manda es que el pipeline procesa UN frame cada
# FRAME_INTERVAL_SECONDS (2s), no 30 por segundo: hay presupuesto de cómputo de sobra
# y no tiene sentido pagar el costo en precisión de una configuración pensada para
# tiempo real.
#
# Costo medido sobre 20 frames reales de 1920x1080 (p90 contra el presupuesto de 2000 ms):
#
#     modelo      imgsz=640   imgsz=960   imgsz=1280
#     yolov8n        11.5%       13.5%       22.6%
#     yolov8s        17.8%       33.4%       65.0%
#     yolov8m        39.4%       64.3%       no entra
#
# Se eligió yolov8s + imgsz 960: sube en los dos ejes a la vez (modelo y resolución)
# y usa un tercio del presupuesto, dejando margen para las llamadas al backend que
# el mismo ciclo hace y para hardware más lento que el de desarrollo. Los tres son
# configurables para poder subirlos tras las pruebas con gente real.
YOLO_MODEL_PATH = ruta("YOLO_MODEL_PATH", "models/yolov8s.pt")

# Resolución a la que YOLO corre la inferencia. El default de ultralytics es 640, y con
# frames de 1920x1080 eso significa reescalar a un tercio: una persona de 120 px de alto
# queda en 40 px, que es donde el modelo empieza a perderla. Es el parámetro que más
# afecta a la gente lejana o parcialmente tapada, que es justo el caso de un salón.
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "960"))

# Umbral de confianza. 0.5 es alto para personas ocluidas detrás de mesas. Se puede
# bajar sin miedo porque hay dos filtros aguas abajo que absorben el ruido: la detección
# tiene que caer dentro del ROI de una mesa (OVERLAP_MINIMO) y además sostenerse
# CONFIRMACION_SEGUNDOS. El sistema tolera más ruido de entrada de lo que sugiere el
# número suelto.
YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.35"))
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

# Qué parte del bounding box se compara contra el ROI (T26-180):
#   bbox_completo    - la persona entera (criterio histórico, default)
#   tercio_inferior  - solo el tercio de abajo, o sea dónde está apoyada
# El tercio inferior debería portarse mejor con gente SENTADA, porque el bbox de
# una persona es alto y con una cámara baja buena parte queda por encima de la
# mesa en el plano de la imagen. Pero cambia la semántica de OVERLAP_MINIMO y
# todavía no se pudo medir contra una escena real con gente sentada, así que el
# default no se toca. Cuando se hagan las pruebas físicas, comparar los dos.
ANCLAJE_OVERLAP = os.getenv("ANCLAJE_OVERLAP", "bbox_completo").strip()
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
