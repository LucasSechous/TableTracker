# Captura un lote de frames de la fuente configurada y lo guarda como material de
# banco de pruebas (T26-182).
#
# Por qué existe: la comparación de configuraciones de detección (T26-178/179/180)
# solo tiene sentido si las tres se miden sobre EXACTAMENTE los mismos fotogramas.
# Medir "en vivo" contra la cámara compara escenas distintas y el resultado no dice
# nada: cambió el modelo, pero también cambió quién estaba sentado.
#
# El lote incluye un metadata.json con resolución, horario y condiciones de luz,
# porque un frame nocturno infrarrojo y uno diurno son escenas tan distintas que
# comparar entre lotes sin saber cuál es cuál lleva a conclusiones falsas — que es
# justamente lo que pasó al intentar medir T26-178 sobre la cámara vieja.
#
# Uso:
#   python -m scripts.capturar_muestras --etiqueta salon-diurno --cantidad 40 \
#       --intervalo 1.5 --condiciones "luz de día, 2 personas sentadas"
#
# La salida va a data/samples/<etiqueta>/, que está gitignoreada: el material es
# pesado y a veces tiene gente identificable.

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2

from app import config
from app.capture.camera import Camera
from app.utils import rtsp_url
from app.utils.logger import get_logger

logger = get_logger(__name__)

MUESTRAS_DIR = Path(__file__).resolve().parents[1] / "data" / "samples"


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Captura frames de la fuente configurada para el banco de pruebas (T26-182)."
    )
    parser.add_argument(
        "--etiqueta",
        required=True,
        help="Nombre de la carpeta del lote, por ejemplo 'salon-diurno' o 'salon-nocturno-ir'.",
    )
    parser.add_argument("--cantidad", type=int, default=40, help="Cuántos frames guardar.")
    parser.add_argument(
        "--intervalo",
        type=float,
        default=1.5,
        help="Segundos entre capturas. Conviene que no sea muy chico: dos frames "
        "consecutivos de la misma escena son casi el mismo dato y no aportan variedad.",
    )
    parser.add_argument(
        "--condiciones",
        required=True,
        help="Descripción libre de la escena y la luz. Queda en metadata.json y es lo "
        "que después permite saber qué se estaba midiendo.",
    )
    parser.add_argument(
        "--fuente",
        default=None,
        help="Fuente alternativa (ruta de video o URL). Por defecto usa VIDEO_SOURCE del .env.",
    )
    return parser.parse_args()


def main():
    args = _parse_args()
    fuente = args.fuente if args.fuente is not None else config.VIDEO_SOURCE

    destino = MUESTRAS_DIR / args.etiqueta
    if destino.exists() and any(destino.glob("*.jpg")):
        raise SystemExit(
            f"{destino} ya tiene frames. Elegí otra --etiqueta en vez de mezclar dos lotes: "
            "un lote con escenas de condiciones distintas no sirve para comparar."
        )
    destino.mkdir(parents=True, exist_ok=True)

    camera = Camera(fuente)
    camera.open()
    logger.info("Capturando %d frames de %s", args.cantidad, rtsp_url.enmascarar(fuente))

    guardados = 0
    descartados = 0
    resolucion = None
    inicio = datetime.now(timezone.utc)

    try:
        while guardados < args.cantidad:
            frame = camera.read_frame()
            if frame is None:
                # Con RTSP los primeros read_frame() pueden venir vacíos mientras el hilo
                # de drenaje todavía no recibió nada. Se tolera un margen y después se corta:
                # seguir esperando indefinidamente esconde una cámara caída.
                descartados += 1
                if descartados > args.cantidad + 20:
                    logger.error("La fuente no entrega frames, se corta con %d guardados", guardados)
                    break
                continue

            if resolucion is None:
                alto, ancho = frame.shape[:2]
                resolucion = {"ancho": ancho, "alto": alto}
                logger.info("Resolución de la fuente: %dx%d", ancho, alto)

            archivo = destino / f"frame_{guardados:03d}.jpg"
            cv2.imwrite(str(archivo), frame)
            guardados += 1
            logger.info("[%d/%d] %s", guardados, args.cantidad, archivo.name)

            if guardados < args.cantidad:
                time.sleep(args.intervalo)
    finally:
        camera.release()

    metadata = {
        "etiqueta": args.etiqueta,
        # Enmascarada: la URL RTSP lleva la contraseña de la cámara y este archivo
        # se comparte al discutir resultados.
        "fuente": rtsp_url.enmascarar(fuente),
        "condiciones": args.condiciones,
        "resolucion": resolucion,
        "frames_guardados": guardados,
        "intervalo_segundos": args.intervalo,
        "inicio_utc": inicio.isoformat(),
        "fin_utc": datetime.now(timezone.utc).isoformat(),
    }
    (destino / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    logger.info("Lote guardado en %s (%d frames)", destino, guardados)
    print(f"\n{guardados} frames en {destino}")
    print(f"Condiciones: {args.condiciones}")
    print(f"\nPara medir sobre este lote:\n  python -m scripts.benchmark_deteccion --muestras {args.etiqueta}")


if __name__ == "__main__":
    main()
