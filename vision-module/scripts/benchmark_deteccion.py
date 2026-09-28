# Compara configuraciones de detección sobre un lote fijo de frames (T26-182).
#
# Por qué existe: T26-178 (imgsz), T26-179 (modelo) y T26-180 (anclaje del solape)
# quedaron implementados y configurables, pero sus valores se eligieron con una
# medición que NO se puede reproducir — se hizo a mano sobre frames sueltos y no
# quedó script. Este archivo cierra ese hueco: dado un lote de data/samples, corre
# la matriz modelo x imgsz x confianza sobre los MISMOS fotogramas y saca una tabla
# comparable.
#
# Qué mide y qué no:
#   - Siempre mide cobertura (en cuántos frames el modelo encontró al menos una
#     persona), cuántas personas encontró y cuánto tardó.
#   - Si el lote trae un etiquetas.json con cuánta gente hay en cada frame, suma
#     recall y precisión A NIVEL FRAME. Sin ese archivo no hay con qué distinguir
#     un acierto de un falso positivo y la tabla se queda en cobertura, que en un
#     lote con frames vacíos tiene un techo: superarlo no es ver más gente, es
#     inventarla.
#
# Uso:
#   python -m scripts.benchmark_deteccion --muestras salon-diurno
#   python -m scripts.benchmark_deteccion --muestras salon-diurno \
#       --modelos yolov8n.pt,yolov8s.pt --imgsz 640,960,1280 --confianza 0.25,0.35

import argparse
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2

from app import config
from app.detection.detector import Detector
from app.utils.logger import get_logger

logger = get_logger(__name__)

RAIZ = Path(__file__).resolve().parents[1]
MUESTRAS_DIR = RAIZ / "data" / "samples"
RESULTADOS_DIR = Path(__file__).resolve().parent / "resultados"


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Corre una matriz de configuraciones de detección sobre un lote de frames (T26-182)."
    )
    parser.add_argument("--muestras", required=True, help="Nombre del lote en data/samples/.")
    parser.add_argument(
        "--modelos",
        default="yolov8n.pt,yolov8s.pt",
        help="Nombres de archivo de pesos, separados por coma. Se resuelven contra models/.",
    )
    parser.add_argument("--imgsz", default="640,960,1280", help="Resoluciones de inferencia, separadas por coma.")
    parser.add_argument("--confianza", default="0.35", help="Umbrales de confianza, separados por coma.")
    return parser.parse_args()


def _lista(texto, conversor):
    return [conversor(x.strip()) for x in texto.split(",") if x.strip()]


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


def _calidad(frames, detecciones_por_frame, etiquetas):
    """Acierto y falso positivo A NIVEL FRAME, contra el conteo anotado a mano.

    Deliberadamente no se evalúa por persona: las etiquetas dicen cuánta gente hay en
    cada frame, no dónde, así que emparejar cada detección con una persona sería
    inventar una correspondencia. A nivel frame la pregunta es la que le importa al
    pipeline —¿había alguien y lo vio?— y se responde sin ambigüedad.

    Sin etiquetas devuelve todo en None y la tabla se lee como antes.
    """
    vacio = {
        "recall_frames_pct": None,
        "precision_frames_pct": None,
        "conteo_exacto_pct": None,
        "falsos_positivos_frames": None,
        "falsos_negativos_frames": None,
        "personas_esperadas": None,
    }
    if not etiquetas:
        return vacio

    esperado = etiquetas.get("personas_por_frame", {})
    pares = [(esperado.get(nombre), detectadas) for (nombre, _), detectadas in zip(frames, detecciones_por_frame)]
    pares = [(e, d) for e, d in pares if e is not None]
    if not pares:
        logger.warning("Las etiquetas no cubren ningún frame de este lote, se ignoran")
        return vacio

    verdaderos = sum(1 for e, d in pares if e > 0 and d > 0)
    falsos_positivos = sum(1 for e, d in pares if e == 0 and d > 0)
    falsos_negativos = sum(1 for e, d in pares if e > 0 and d == 0)
    con_gente = verdaderos + falsos_negativos
    dijo_que_hay = verdaderos + falsos_positivos

    # Cuántos frames tienen el CONTEO bien, no sólo la presencia. El recall de arriba
    # se satura: con dos personas sentadas, encontrar a una sola ya cuenta como acierto,
    # y en un lote real todas las configuraciones dan 100%. Esta columna es la que
    # separa "vio a alguien" de "los vio a todos", que es lo que decide si una mesa con
    # cuatro comensales se reporta bien.
    conteo_exacto = sum(1 for e, d in pares if e == d)

    return {
        "recall_frames_pct": round(100 * verdaderos / con_gente, 1) if con_gente else None,
        "precision_frames_pct": round(100 * verdaderos / dijo_que_hay, 1) if dijo_que_hay else None,
        "conteo_exacto_pct": round(100 * conteo_exacto / len(pares), 1),
        "falsos_positivos_frames": falsos_positivos,
        "falsos_negativos_frames": falsos_negativos,
        "personas_esperadas": sum(e for e, _ in pares),
    }


def _medir(detector, frames, etiquetas=None):
    """Corre el detector sobre todos los frames y devuelve las métricas del lote.

    La primera inferencia de cada modelo cuesta mucho más que las siguientes —
    ultralytics termina de inicializar recién al primer predict()— y en un lote de 20
    frames ese único outlier arrastra la media por encima del p90, que es un absurdo
    aritmético y una señal clara de que el número no describe el régimen normal. Se
    hace una pasada de calentamiento fuera del cronómetro.
    """
    detector.detect(frames[0][1])

    tiempos = []
    detecciones_por_frame = []
    confianzas = []

    for _, imagen in frames:
        inicio = time.monotonic()
        detecciones = detector.detect(imagen)
        tiempos.append(time.monotonic() - inicio)
        detecciones_por_frame.append(len(detecciones))
        confianzas.extend(d.confianza for d in detecciones)

    con_deteccion = sum(1 for n in detecciones_por_frame if n > 0)
    return {
        "frames": len(frames),
        "frames_con_deteccion": con_deteccion,
        # Sobre cuántos frames encontró algo. Con un lote donde SE SABE que hay gente
        # en todos, esto se acerca al recall; con un lote mixto es solo cobertura.
        "cobertura_pct": round(100 * con_deteccion / len(frames), 1) if frames else 0.0,
        "detecciones_totales": sum(detecciones_por_frame),
        "detecciones_por_frame": round(statistics.mean(detecciones_por_frame), 2) if detecciones_por_frame else 0.0,
        "confianza_media": round(statistics.mean(confianzas), 3) if confianzas else None,
        "ms_medio": round(1000 * statistics.mean(tiempos), 1) if tiempos else 0.0,
        # El p90 es el que importa para el presupuesto del ciclo: lo que manda no es el
        # caso típico sino el mal rato, que es cuando se pasa de FRAME_INTERVAL_SECONDS
        # y la cadencia se degrada (ver registrar_presupuesto en app/main.py).
        "ms_p90": round(1000 * sorted(tiempos)[int(0.9 * (len(tiempos) - 1))], 1) if tiempos else 0.0,
        **_calidad(frames, detecciones_por_frame, etiquetas),
    }


def main():
    args = _parse_args()
    carpeta = MUESTRAS_DIR / args.muestras
    frames = _cargar_frames(carpeta)

    metadata_path = carpeta / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    condiciones = metadata.get("condiciones", "sin registrar")

    # Etiquetas opcionales: si alguien anotó a mano cuánta gente hay en cada frame,
    # la tabla suma recall y precisión. Ver _calidad.
    etiquetas_path = carpeta / "etiquetas.json"
    etiquetas = json.loads(etiquetas_path.read_text(encoding="utf-8")) if etiquetas_path.exists() else None

    modelos = _lista(args.modelos, str)
    resoluciones = _lista(args.imgsz, int)
    confianzas = _lista(args.confianza, float)

    presupuesto_ms = 1000 * config.FRAME_INTERVAL_SECONDS

    print(f"\nLote: {args.muestras} — {len(frames)} frames")
    print(f"Condiciones: {condiciones}")
    print(f"Presupuesto del ciclo: {presupuesto_ms:.0f} ms (FRAME_INTERVAL_SECONDS={config.FRAME_INTERVAL_SECONDS})")
    if etiquetas:
        print(
            f"Etiquetado a mano: {etiquetas['frames_con_gente']}/{etiquetas['frames_totales']} frames con gente "
            f"({etiquetas['cobertura_maxima_pct']}% es el TECHO de cobertura), "
            f"{etiquetas['personas_totales']} personas en total"
        )
    print()

    encabezado = (
        f"{'modelo':<14}{'imgsz':>7}{'conf':>7}{'cobertura':>11}{'det/frame':>11}"
        f"{'conf.media':>12}{'ms medio':>10}{'ms p90':>9}{'% presup.':>11}"
    )
    if etiquetas:
        encabezado += f"{'recall':>9}{'precision':>11}{'conteo ok':>11}{'FP':>5}{'FN':>5}"
    print(encabezado)
    print("-" * len(encabezado))

    resultados = []
    for nombre_modelo in modelos:
        ruta_modelo = RAIZ / "models" / nombre_modelo
        for imgsz in resoluciones:
            for confianza in confianzas:
                detector = Detector(ruta_modelo, confianza, config.YOLO_CLASSES, imgsz=imgsz)
                detector.load()
                medicion = _medir(detector, frames, etiquetas)
                pct_presupuesto = round(100 * medicion["ms_p90"] / presupuesto_ms, 1)

                fila = {"modelo": nombre_modelo, "imgsz": imgsz, "confianza": confianza,
                        "pct_presupuesto_p90": pct_presupuesto, **medicion}
                resultados.append(fila)

                conf_media = f"{medicion['confianza_media']:.3f}" if medicion["confianza_media"] is not None else "-"
                linea = (
                    f"{nombre_modelo:<14}{imgsz:>7}{confianza:>7.2f}"
                    f"{medicion['cobertura_pct']:>10.1f}%{medicion['detecciones_por_frame']:>11.2f}"
                    f"{conf_media:>12}{medicion['ms_medio']:>10.1f}{medicion['ms_p90']:>9.1f}"
                    f"{pct_presupuesto:>10.1f}%"
                )
                if etiquetas:
                    recall = medicion["recall_frames_pct"]
                    precision = medicion["precision_frames_pct"]
                    conteo = medicion["conteo_exacto_pct"]
                    linea += (
                        f"{(f'{recall:.1f}%' if recall is not None else '-'):>9}"
                        f"{(f'{precision:.1f}%' if precision is not None else '-'):>11}"
                        f"{(f'{conteo:.1f}%' if conteo is not None else '-'):>11}"
                        f"{medicion['falsos_positivos_frames']:>5}{medicion['falsos_negativos_frames']:>5}"
                    )
                print(linea)

    RESULTADOS_DIR.mkdir(parents=True, exist_ok=True)
    salida = RESULTADOS_DIR / f"bench_{args.muestras}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    salida.write_text(
        json.dumps(
            {
                "lote": args.muestras,
                "condiciones": condiciones,
                "frames": len(frames),
                "etiquetado": bool(etiquetas),
                "presupuesto_ms": presupuesto_ms,
                "generado_utc": datetime.now(timezone.utc).isoformat(),
                "resultados": resultados,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nDetalle en {salida}")
    if etiquetas:
        print(
            "\nCómo leerlo: 'conteo ok' es la columna que decide — en qué porcentaje de frames\n"
            "encontró EXACTAMENTE la gente que había. El recall se satura y no sirve para elegir:\n"
            "con dos personas sentadas, hallar una sola ya cuenta como acierto, así que en un lote\n"
            "real da 100% en todas las configuraciones.\n"
            "La cobertura sola miente en un lote con frames vacíos: superar el techo no es ver más\n"
            "gente, es inventarla, y eso sale en FP (frames donde no había nadie y dijo que sí).\n"
            "FN son los frames con gente que se le pasaron enteros. Una configuración que se pase\n"
            "del 100% del presupuesto degrada la cadencia del bucle en silencio."
        )
    else:
        print(
            "\nCómo leerlo: cobertura alta con % de presupuesto bajo es lo que se busca. Una "
            "configuración que se pase del 100% degrada la cadencia del bucle en silencio.\n"
            "Ojo: sin frames anotados a mano, más detecciones NO es necesariamente mejor — puede\n"
            "ser el mismo acierto o un falso positivo. Anotá el lote en etiquetas.json para que\n"
            "esta tabla sume recall y precisión."
        )


if __name__ == "__main__":
    main()
