# Script de prueba manual para T26-103: corre Camera + Detector sobre una
# fuente real (webcam o RTSP) y guarda un resumen de detecciones en JSON.

import argparse
import json
import signal
import time
from datetime import datetime, timezone
from pathlib import Path

from app import config
from app.capture.camera import RTSP, WEBCAM, Camera, tipo_de_fuente
from app.detection.detector import Detector
from app.utils.logger import get_logger

logger = get_logger(__name__)

RESULTADOS_DIR = Path(__file__).resolve().parent / "resultados"

# Mapea el --source de línea de comandos al tipo que devuelve tipo_de_fuente().
_TIPOS_POR_SOURCE = {"webcam": WEBCAM, "rtsp": RTSP}


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Prueba Camera + Detector contra una fuente real (T26-103)."
    )
    parser.add_argument("--source", choices=sorted(_TIPOS_POR_SOURCE), required=True)
    parser.add_argument("--duracion", type=float, default=30)
    parser.add_argument("--etiqueta", default=None)
    parser.add_argument("--condiciones", default="sin especificar")
    return parser.parse_args()


def _resolver_fuente(source_arg):
    # VIDEO_SOURCE (config/.env) ya trae el índice de webcam o la URL RTSP
    # con credenciales incluidas; acá solo se valida que coincida con --source
    # para no reusar por error una fuente configurada para otro tipo de prueba.
    tipo_esperado = _TIPOS_POR_SOURCE[source_arg]
    tipo_real = tipo_de_fuente(config.VIDEO_SOURCE)
    if tipo_real != tipo_esperado:
        raise SystemExit(
            f"--source {source_arg} espera VIDEO_SOURCE de tipo '{tipo_esperado}', pero "
            f"vision-module/.env tiene {config.VIDEO_SOURCE!r} (tipo '{tipo_real}'). "
            "Ajustá VIDEO_SOURCE antes de correr esta prueba."
        )
    return config.VIDEO_SOURCE


def _nombre_clase(detector, clase_idx):
    return detector.model.names.get(clase_idx, str(clase_idx))


def _resumen_por_clase(acumulado):
    return {
        clase: {
            "total_detecciones": datos["total"],
            "confianza_promedio": round(sum(datos["confianzas"]) / len(datos["confianzas"]), 4),
            "confianza_minima": round(min(datos["confianzas"]), 4),
            "confianza_maxima": round(max(datos["confianzas"]), 4),
        }
        for clase, datos in acumulado.items()
    }


def main():
    args = _parse_args()
    etiqueta = args.etiqueta or args.source
    fuente = _resolver_fuente(args.source)

    camera = Camera(fuente)
    detector = Detector(config.YOLO_MODEL_PATH, config.YOLO_CONFIDENCE, config.YOLO_CLASSES)
    camera.open()
    detector.load()

    acumulado_por_clase = {}
    frames_procesados = 0
    frames_sin_detecciones = 0

    detener = {"pedido": False}

    def _pedir_fin(signum, frame):
        detener["pedido"] = True
        logger.info("Corte manual solicitado (Ctrl+C), guardando resumen parcial")

    signal.signal(signal.SIGINT, _pedir_fin)

    inicio = time.monotonic()
    try:
        while not detener["pedido"] and (time.monotonic() - inicio) < args.duracion:
            frame = camera.read_frame()
            if frame is None:
                logger.warning("La fuente dejó de devolver frames, cortando antes de tiempo")
                break

            timestamp = datetime.now(timezone.utc).isoformat()
            detecciones = detector.detect(frame)
            frames_procesados += 1

            if not detecciones:
                frames_sin_detecciones += 1
                logger.debug("frame timestamp=%s sin detecciones", timestamp)

            for deteccion in detecciones:
                clase = _nombre_clase(detector, deteccion.clase)
                registro = acumulado_por_clase.setdefault(clase, {"total": 0, "confianzas": []})
                registro["total"] += 1
                registro["confianzas"].append(deteccion.confianza)

                logger.debug(
                    "frame timestamp=%s clase=%s confianza=%.3f detecciones_en_frame=%d",
                    timestamp,
                    clase,
                    deteccion.confianza,
                    len(detecciones),
                )
    finally:
        camera.release()

    duracion_real = time.monotonic() - inicio
    fps_promedio = frames_procesados / duracion_real if duracion_real > 0 else 0.0

    resumen = {
        "etiqueta": etiqueta,
        "fuente": str(fuente),
        "tipo_fuente": args.source,
        "condiciones": args.condiciones,
        "duracion_solicitada_segundos": args.duracion,
        "duracion_real_segundos": round(duracion_real, 2),
        "frames_procesados": frames_procesados,
        "fps_promedio": round(fps_promedio, 2),
        "frames_sin_detecciones": frames_sin_detecciones,
        "por_clase": _resumen_por_clase(acumulado_por_clase),
    }

    RESULTADOS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp_archivo = datetime.now().strftime("%Y%m%d_%H%M%S")
    salida = RESULTADOS_DIR / f"{etiqueta}_{timestamp_archivo}.json"
    salida.write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info("Resultados guardados en %s", salida)
    print(f"Resultados guardados en {salida}")


if __name__ == "__main__":
    main()
