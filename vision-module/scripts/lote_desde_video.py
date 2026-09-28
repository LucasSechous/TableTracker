# Arma un lote del banco de pruebas a partir de un archivo de video (T26-182).
#
# Por qué existe aparte de capturar_muestras.py: ese script captura EN VIVO de la
# cámara y su problema es esperar a que el stream entregue algo. Acá la fuente es un
# archivo y el problema es el opuesto —hay demasiados frames— así que se muestrea uno
# cada N segundos de video. Dos frames consecutivos a 30 fps son el mismo dato.
#
# El muestreo se hace por tiempo de video y no por cantidad de frames para que un lote
# sacado de un video de 25 fps y otro de uno de 30 fps sean comparables entre sí.
#
# Uso:
#   python -m scripts.lote_desde_video --video data/videos/salon.mp4 \
#       --etiqueta salon-almuerzo --condiciones "hora pico, 3 mesas ocupadas"

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import cv2

from app.utils.logger import get_logger

logger = get_logger(__name__)

RAIZ = Path(__file__).resolve().parents[1]
MUESTRAS_DIR = RAIZ / "data" / "samples"


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Extrae un lote de frames de un archivo de video para el banco (T26-182)."
    )
    parser.add_argument("--video", required=True, help="Ruta del archivo de video.")
    parser.add_argument("--etiqueta", required=True, help="Nombre de la carpeta del lote en data/samples/.")
    parser.add_argument(
        "--cada-segundos",
        type=float,
        default=2.0,
        help="Cada cuántos segundos DE VIDEO se guarda un frame. Por defecto 2.0, que es "
        "la cadencia del pipeline (FRAME_INTERVAL_SECONDS).",
    )
    parser.add_argument(
        "--maximo",
        type=int,
        default=None,
        help="Tope de frames a guardar. Sin esto se recorre el video entero.",
    )
    parser.add_argument(
        "--condiciones",
        required=True,
        help="Descripción libre de la escena y la luz. Queda en metadata.json.",
    )
    return parser.parse_args()


def main():
    args = _parse_args()
    video = Path(args.video)
    if not video.exists():
        raise SystemExit(f"No existe el video: {video}")

    destino = MUESTRAS_DIR / args.etiqueta
    # Mismo criterio que capturar_muestras: mezclar dos escenas en un lote hace
    # incomparable la medición.
    if destino.exists() and any(destino.glob("*.jpg")):
        raise SystemExit(
            f"{destino} ya tiene frames. Elegí otra --etiqueta en vez de mezclar dos lotes."
        )
    destino.mkdir(parents=True, exist_ok=True)

    captura = cv2.VideoCapture(str(video))
    if not captura.isOpened():
        raise SystemExit(f"No se pudo abrir el video: {video}")

    fps = captura.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        # Algunos contenedores no declaran fps. 25 es un default razonable y queda
        # anotado en la metadata para que se sepa que fue una suposición.
        logger.warning("El video no declara fps, se asume 25")
        fps = 25.0
        fps_declarado = False
    else:
        fps_declarado = True

    salto = max(1, round(fps * args.cada_segundos))
    total_frames = int(captura.get(cv2.CAP_PROP_FRAME_COUNT)) or None
    logger.info(
        "Video %s: %.2f fps, se guarda uno cada %d frames (%.1fs de video)",
        video.name,
        fps,
        salto,
        args.cada_segundos,
    )

    guardados = 0
    indice = 0
    resolucion = None

    while True:
        ok, frame = captura.read()
        if not ok:
            break

        if indice % salto == 0:
            if resolucion is None:
                alto, ancho = frame.shape[:2]
                resolucion = {"ancho": ancho, "alto": alto}
                logger.info("Resolución: %dx%d", ancho, alto)
            cv2.imwrite(str(destino / f"frame_{guardados:03d}.jpg"), frame)
            guardados += 1
            if args.maximo is not None and guardados >= args.maximo:
                break

        indice += 1

    captura.release()

    if guardados == 0:
        raise SystemExit(f"No se pudo leer ningún frame de {video}")

    metadata = {
        "etiqueta": args.etiqueta,
        "fuente": f"video: {video.name}",
        "condiciones": args.condiciones,
        "resolucion": resolucion,
        "frames_guardados": guardados,
        "video_fps": round(fps, 2),
        "video_fps_declarado": fps_declarado,
        "video_frames_totales": total_frames,
        "intervalo_segundos": args.cada_segundos,
        "generado_utc": datetime.now(timezone.utc).isoformat(),
    }
    (destino / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n{guardados} frames en {destino}")
    print(f"Condiciones: {args.condiciones}")
    print(
        "\nPara medir sobre este lote:\n"
        f"  python -m scripts.benchmark_deteccion --muestras {args.etiqueta}\n"
        "\nPara que la tabla sume recall y precisión, anotá cuánta gente hay en cada frame\n"
        f"en {destino / 'etiquetas.json'} — ver docs/banco-pruebas-vision.md."
    )


if __name__ == "__main__":
    main()
