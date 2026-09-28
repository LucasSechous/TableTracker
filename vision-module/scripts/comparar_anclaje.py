# Compara los dos anclajes del solape sobre un lote fijo de frames (T26-180, sobre el
# banco de T26-182).
#
# Por qué existe: benchmark_deteccion.py responde "¿el modelo ve a la gente?", pero no
# "¿a qué mesa la asigna?". ANCLAJE_OVERLAP quedó configurable y sin poder elegirse
# justamente porque nadie podía medir la segunda pregunta, y el procedimiento del banco
# (docs/banco-pruebas-vision.md, paso 6) la pide a mano. Esto la automatiza.
#
# Qué compara:
#   bbox_completo    - la persona entera contra el ROI (criterio histórico, default)
#   tercio_inferior  - solo el tercio de abajo, o sea dónde está apoyada
#
# La detección se corre UNA sola vez por frame y los dos anclajes se evalúan sobre esas
# mismas cajas. No es sólo por tiempo: correr el detector dos veces admitiría resultados
# distintos entre pasadas y la comparación dejaría de aislar la única variable que se
# quiere medir.
#
# Qué mide y qué no: igual que el benchmark, no hay etiquetas de verdad. Sabemos dónde
# está cada ROI, no cuánta gente había sentada a cada mesa. Así que esto no dice
# "acertó": dice a cuántas mesas asignó y cuántas detecciones quedaron sin mesa. El
# número que más ayuda a decidir es ese último — una persona sentada que no cae en
# ninguna mesa es una mesa que el sistema va a reportar libre estando ocupada.
#
# Uso:
#   python -m scripts.comparar_anclaje --muestras salon-diurno
#   python -m scripts.comparar_anclaje --muestras salon-nocturno-ir --overlap 0.20

import argparse
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

import cv2

from app import config
from app.client.backend_client import BackendClient
from app.detection.detector import Detector
from app.mapping import zonas as zonas_mod
from app.utils.logger import get_logger

logger = get_logger(__name__)

RAIZ = Path(__file__).resolve().parents[1]
MUESTRAS_DIR = RAIZ / "data" / "samples"
RESULTADOS_DIR = Path(__file__).resolve().parent / "resultados"


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Compara bbox_completo contra tercio_inferior sobre un lote de frames (T26-180)."
    )
    parser.add_argument("--muestras", required=True, help="Nombre del lote en data/samples/.")
    parser.add_argument(
        "--camara",
        type=int,
        default=None,
        help="Id de la cámara cuyos ROI usar. Por defecto, la del sector de config (SECTOR_ID/CAMARA_ID).",
    )
    parser.add_argument(
        "--modelo",
        default=None,
        help="Nombre de archivo de pesos, que se resuelve contra models/. Por defecto, YOLO_MODEL_PATH.",
    )
    parser.add_argument("--imgsz", type=int, default=None, help="Resolución de inferencia. Por defecto, YOLO_IMGSZ.")
    parser.add_argument(
        "--confianza", type=float, default=None, help="Umbral de confianza. Por defecto, YOLO_CONFIDENCE."
    )
    parser.add_argument(
        "--overlap",
        type=float,
        default=None,
        help="Fracción del bbox que tiene que caer en el ROI. Por defecto, OVERLAP_MINIMO.",
    )
    return parser.parse_args()


def _cargar_frames(carpeta):
    archivos = sorted(carpeta.glob("*.jpg"))
    if not archivos:
        raise SystemExit(f"No hay frames .jpg en {carpeta}. Generá el lote con scripts/capturar_muestras.py.")
    frames = []
    for archivo in archivos:
        imagen = cv2.imread(str(archivo))
        if imagen is None:
            logger.warning("No se pudo leer %s, se saltea", archivo.name)
            continue
        frames.append((archivo.name, imagen))
    return frames


def _resolver_camara(cliente, camara_id):
    camaras = cliente.listar_camaras(sector_id=config.SECTOR_ID)
    if not camaras:
        raise SystemExit(f"El sector {config.SECTOR_ID} no tiene cámaras activas.")
    if camara_id is None:
        camara_id = config.CAMARA_ID
    if camara_id is None:
        if len(camaras) > 1:
            disponibles = ", ".join(f"{c['id']} ({c['nombre']})" for c in camaras)
            raise SystemExit(f"Hay varias cámaras activas: {disponibles}. Elegí una con --camara.")
        return camaras[0]
    elegida = next((c for c in camaras if c["id"] == camara_id), None)
    if elegida is None:
        raise SystemExit(f"La cámara {camara_id} no está activa en el sector {config.SECTOR_ID}.")
    return elegida


def _evaluar(zonas, detecciones_por_frame, overlap_minimo, anclaje):
    """Recorre el lote con un anclaje y resume cómo quedó la asignación.

    `frames_ocupada` cuenta frames, no personas: dos personas en la misma mesa en el
    mismo frame son una sola mesa ocupada, que es lo que el pipeline termina publicando.
    """
    ocupada_en = {zona.mesa_id: 0 for zona in zonas}
    overlaps_por_mesa = {zona.mesa_id: [] for zona in zonas}
    detecciones_totales = 0
    detecciones_sin_mesa = 0

    for detecciones in detecciones_por_frame:
        detecciones_totales += len(detecciones)

        # Se mira detección por detección y no sólo el máximo por zona, porque acá
        # interesa cuánta gente queda huérfana, no sólo si la mesa dio ocupada.
        for deteccion in detecciones:
            mejor = max((zona.overlap(deteccion.bbox, anclaje) for zona in zonas), default=0.0)
            if mejor < overlap_minimo:
                detecciones_sin_mesa += 1

        ocupacion = zonas_mod.resolver_ocupacion(zonas, detecciones, overlap_minimo, anclaje)
        for mesa_id, ocupada in ocupacion.items():
            if ocupada:
                ocupada_en[mesa_id] += 1

        for zona in zonas:
            overlaps = [zona.overlap(d.bbox, anclaje) for d in detecciones]
            if overlaps:
                overlaps_por_mesa[zona.mesa_id].append(max(overlaps))

    total_frames = len(detecciones_por_frame)
    return {
        "anclaje": anclaje,
        "frames": total_frames,
        "detecciones_totales": detecciones_totales,
        "detecciones_sin_mesa": detecciones_sin_mesa,
        "pct_sin_mesa": round(100 * detecciones_sin_mesa / detecciones_totales, 1) if detecciones_totales else 0.0,
        "mesas": {
            str(mesa_id): {
                "frames_ocupada": ocupada_en[mesa_id],
                "pct_frames_ocupada": round(100 * ocupada_en[mesa_id] / total_frames, 1) if total_frames else 0.0,
                "overlap_medio": round(statistics.mean(overlaps_por_mesa[mesa_id]), 3)
                if overlaps_por_mesa[mesa_id]
                else 0.0,
                "overlap_max": round(max(overlaps_por_mesa[mesa_id]), 3) if overlaps_por_mesa[mesa_id] else 0.0,
            }
            for mesa_id in ocupada_en
        },
    }


def main():
    args = _parse_args()
    carpeta = MUESTRAS_DIR / args.muestras
    frames = _cargar_frames(carpeta)

    metadata_path = carpeta / "metadata.json"
    condiciones = "sin registrar"
    if metadata_path.exists():
        condiciones = json.loads(metadata_path.read_text(encoding="utf-8")).get("condiciones", condiciones)

    cliente = BackendClient(
        config.BACKEND_URL, config.BACKEND_EMAIL, config.BACKEND_PASSWORD, timeout=config.BACKEND_TIMEOUT
    )
    cliente.login()
    camara = _resolver_camara(cliente, args.camara)
    rois = cliente.listar_rois(camara["id"])
    if not rois:
        raise SystemExit(f"La cámara {camara['id']} no tiene ROI activos: dibujalos antes de comparar.")
    zonas = zonas_mod.desde_rois(rois)

    # Un --modelo suelto se resuelve contra models/, igual que en el benchmark. Pasarlo
    # tal cual hacía que ultralytics no lo encontrara y se bajara los pesos de internet
    # al directorio de ejecución, midiendo con un archivo distinto del versionado.
    modelo = (RAIZ / "models" / args.modelo) if args.modelo else config.YOLO_MODEL_PATH
    imgsz = args.imgsz or config.YOLO_IMGSZ
    confianza = args.confianza if args.confianza is not None else config.YOLO_CONFIDENCE
    overlap_minimo = args.overlap if args.overlap is not None else config.OVERLAP_MINIMO

    detector = Detector(modelo, confianza, config.YOLO_CLASSES, imgsz=imgsz)
    detector.load()

    # Una sola pasada de detección: los dos anclajes se miden sobre las mismas cajas.
    detecciones_por_frame = [detector.detect(imagen) for _, imagen in frames]

    print(f"\nLote: {args.muestras} - {len(frames)} frames")
    print(f"Condiciones: {condiciones}")
    print(f"Camara {camara['id']} ({camara['nombre']}) - {len(zonas)} ROI activos")
    print(f"Modelo {Path(str(modelo)).name}, imgsz {imgsz}, confianza {confianza}, overlap minimo {overlap_minimo}\n")

    resultados = [_evaluar(zonas, detecciones_por_frame, overlap_minimo, anclaje) for anclaje in zonas_mod.ANCLAJES]

    mesas_ordenadas = sorted(resultados[0]["mesas"], key=int)
    encabezado = f"{'anclaje':<18}{'det.':>7}{'sin mesa':>10}{'% sin mesa':>12}"
    for mesa_id in mesas_ordenadas:
        encabezado += f"{'mesa ' + mesa_id:>20}"
    print(encabezado)
    print("-" * len(encabezado))
    for r in resultados:
        fila = (
            f"{r['anclaje']:<18}{r['detecciones_totales']:>7}"
            f"{r['detecciones_sin_mesa']:>10}{r['pct_sin_mesa']:>11.1f}%"
        )
        for mesa_id in mesas_ordenadas:
            m = r["mesas"][mesa_id]
            fila += f"{m['frames_ocupada']:>9} fr{m['overlap_medio']:>8.2f}"
        print(fila)

    RESULTADOS_DIR.mkdir(parents=True, exist_ok=True)
    marca = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    destino = RESULTADOS_DIR / f"anclaje_{args.muestras}_{marca}.json"
    destino.write_text(
        json.dumps(
            {
                "lote": args.muestras,
                "condiciones": condiciones,
                "camara": {"id": camara["id"], "nombre": camara["nombre"]},
                "rois": [{"id": z.roi_id, "mesa_id": z.mesa_id, "poligono": z.poligono} for z in zonas],
                "modelo": Path(str(modelo)).name,
                "imgsz": imgsz,
                "confianza": confianza,
                "overlap_minimo": overlap_minimo,
                "generado_utc": datetime.now(timezone.utc).isoformat(),
                "resultados": resultados,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nDetalle en {destino}")
    print(
        "\nComo leerlo: 'sin mesa' son personas detectadas que no cayeron en ningun ROI -una mesa\n"
        "que se va a reportar libre estando ocupada-. Entre dos anclajes con cobertura parecida\n"
        "gana el que deja menos gente huerfana SIN inventar ocupacion donde no la hay: contrasta\n"
        "'frames_ocupada' contra los frames del lote antes de decidir."
    )


if __name__ == "__main__":
    main()
