# Renderiza un video anotado con lo que hace el pipeline de visión, frame a frame.
#
# Para qué sirve: mostrar el sistema funcionando sin depender de que la cámara, el
# backend, la base y la red estén arriba en ese momento. El MP4 que sale es
# autocontenido y se puede pausar para explicar.
#
# Qué NO es: una reimplementación del pipeline para la demo. Usa las mismas piezas que
# corren en producción —detector, zonas.resolver_ocupacion, Confirmador,
# politica.estado_objetivo— así que lo que se ve es lo que el módulo haría. Lo único
# que no hace es escribir en el backend.
#
# El detalle que hace fiel a la demo: el reloj del Confirmador es el TIEMPO DEL VIDEO,
# no el reloj de pared. Así CONFIRMACION_SEGUNDOS se comporta igual que en vivo y se
# ve lo que de verdad importa —que alguien que pasa caminando no alcanza a marcar la
# mesa como ocupada—, que es más interesante que dibujar cajas sobre personas.
#
# La detección corre una vez cada --cada-segundos de video (la cadencia real del
# pipeline), pero se dibuja sobre TODOS los frames sosteniendo el último resultado.
# Si se emitiera un frame por inferencia el video saldría a los tirones y duraría
# un treintavo de lo que dura el original.
#
# Uso:
#   python -m scripts.render_demo --video data/videos/salon.mp4 --salida demo.mp4
#   python -m scripts.render_demo --video salon.mp4 --salida demo.mp4 --rois rois.json

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from app import config
from app.client.backend_client import BackendClient
from app.detection.detector import Detector
from app.mapping import politica
from app.mapping import zonas as zonas_mod
from app.mapping.confirmacion import Confirmador
from app.utils.logger import get_logger

logger = get_logger(__name__)

RAIZ = Path(__file__).resolve().parents[1]

# Un color por estado del backend (BGR, que es como los quiere OpenCV).
COLORES = {
    politica.LIBRE: (110, 190, 110),
    politica.OCUPADA: (70, 70, 225),
    politica.PENDIENTE_LIMPIEZA: (60, 175, 240),
    politica.RESERVADA: (200, 150, 70),
}
# Etiquetas sin acentos: cv2.putText no dibuja bien nada fuera de ASCII.
NOMBRES = {
    politica.LIBRE: "LIBRE",
    politica.OCUPADA: "OCUPADA",
    politica.PENDIENTE_LIMPIEZA: "PEND. LIMPIEZA",
    politica.RESERVADA: "RESERVADA",
}
COLOR_DETECCION = (250, 220, 120)


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Renderiza un MP4 anotado con la salida del pipeline de visión (T26-182)."
    )
    parser.add_argument("--video", required=True, help="Video de entrada.")
    parser.add_argument("--salida", required=True, help="Ruta del MP4 a generar.")
    parser.add_argument(
        "--rois",
        default=None,
        help="JSON con los ROI, como los devuelve GET /roi-mesa/. Sin esto se piden al backend.",
    )
    parser.add_argument("--camara", type=int, default=None, help="Id de cámara cuyos ROI usar.")
    parser.add_argument("--modelo", default=None, help="Pesos, se resuelven contra models/.")
    parser.add_argument("--imgsz", type=int, default=None, help="Resolución de inferencia.")
    parser.add_argument("--confianza", type=float, default=None, help="Umbral de confianza.")
    parser.add_argument("--overlap", type=float, default=None, help="Fracción mínima del bbox en el ROI.")
    parser.add_argument(
        "--confirmacion",
        type=float,
        default=None,
        help="Segundos sostenidos para confirmar un cambio. Por defecto, CONFIRMACION_SEGUNDOS.",
    )
    parser.add_argument(
        "--cada-segundos",
        type=float,
        default=None,
        help="Cada cuántos segundos de video corre la detección. Por defecto, FRAME_INTERVAL_SECONDS.",
    )
    parser.add_argument(
        "--guardar-rois",
        default=None,
        help="Guarda los ROI usados en este JSON, para poder re-renderizar sin backend.",
    )
    return parser.parse_args()


def _rois_desde_backend(camara_id):
    cliente = BackendClient(
        config.BACKEND_URL, config.BACKEND_EMAIL, config.BACKEND_PASSWORD, timeout=config.BACKEND_TIMEOUT
    )
    cliente.login()
    camaras = cliente.listar_camaras(sector_id=config.SECTOR_ID)
    if not camaras:
        raise SystemExit(f"El sector {config.SECTOR_ID} no tiene cámaras activas.")
    camara_id = camara_id if camara_id is not None else config.CAMARA_ID
    if camara_id is None:
        if len(camaras) > 1:
            disponibles = ", ".join(f"{c['id']} ({c['nombre']})" for c in camaras)
            raise SystemExit(f"Hay varias cámaras activas: {disponibles}. Elegí una con --camara.")
        camara = camaras[0]
    else:
        camara = next((c for c in camaras if c["id"] == camara_id), None)
        if camara is None:
            raise SystemExit(f"La cámara {camara_id} no está activa en el sector {config.SECTOR_ID}.")
    return cliente.listar_rois(camara["id"])


def _dibujar_zonas(frame, zonas, estados, nombres_mesa):
    """Polígonos de cada ROI, rellenos translúcidos y coloreados por estado."""
    capa = frame.copy()
    for zona in zonas:
        estado = estados[zona.mesa_id]
        color = COLORES.get(estado, (180, 180, 180))
        puntos = np.array([[int(x), int(y)] for x, y in zona.poligono], dtype=np.int32)
        cv2.fillPoly(capa, [puntos], color)
    # El relleno va bien suave: tiene que leerse el estado sin perder la escena, que es
    # lo que la gente mira. El contorno, opaco, es el que marca el borde del ROI.
    cv2.addWeighted(capa, 0.14, frame, 0.86, 0, frame)

    for zona in zonas:
        estado = estados[zona.mesa_id]
        color = COLORES.get(estado, (180, 180, 180))
        puntos = np.array([[int(x), int(y)] for x, y in zona.poligono], dtype=np.int32)
        cv2.polylines(frame, [puntos], True, color, 4)

        # La etiqueta va al centro del polígono y no a su vértice más alto: los ROI
        # llegan al borde superior del frame y ahí chocaban entre sí y con el panel.
        cx, cy = puntos[:, 0].mean(), puntos[:, 1].mean()
        etiqueta = f"Mesa {nombres_mesa.get(zona.mesa_id, zona.mesa_id)}: {NOMBRES.get(estado, estado)}"
        (ancho_texto, _), _ = cv2.getTextSize(etiqueta, cv2.FONT_HERSHEY_SIMPLEX, 0.85, 2)
        origen = (int(cx - ancho_texto / 2), int(cy))
        cv2.putText(frame, etiqueta, origen, cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 0, 0), 5)
        cv2.putText(frame, etiqueta, origen, cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)


def _dibujar_detecciones(frame, detecciones):
    for deteccion in detecciones:
        x1, y1, x2, y2 = (int(v) for v in deteccion.bbox)
        cv2.rectangle(frame, (x1, y1), (x2, y2), COLOR_DETECCION, 2)
        cv2.putText(frame, f"{deteccion.confianza:.2f}", (x1, max(20, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, COLOR_DETECCION, 2)


def _dibujar_panel(frame, zonas, estados, nombres_mesa, pendientes, segundos_video, confirmacion):
    """Panel con el estado de cada mesa y la cuenta regresiva de lo que se está confirmando.

    La cuenta sale de `pendientes`, que son las observaciones en curso del propio
    Confirmador. Se leen de él en vez de recalcularlas acá para que lo que se muestra
    no pueda divergir de lo que decide.
    """
    alto_panel = 48 + 34 * len(zonas)
    cv2.rectangle(frame, (20, 20), (560, 20 + alto_panel), (25, 25, 25), -1)
    cv2.rectangle(frame, (20, 20), (560, 20 + alto_panel), (90, 90, 90), 2)
    cv2.putText(frame, f"t = {segundos_video:6.1f}s", (36, 52),
                cv2.FONT_HERSHEY_SIMPLEX, 0.75, (235, 235, 235), 2)

    for i, zona in enumerate(sorted(zonas, key=lambda z: nombres_mesa.get(z.mesa_id, z.mesa_id))):
        estado = estados[zona.mesa_id]
        color = COLORES.get(estado, (180, 180, 180))
        y = 88 + 34 * i
        texto = f"Mesa {nombres_mesa.get(zona.mesa_id, zona.mesa_id)}: {NOMBRES.get(estado, estado)}"

        pendiente = pendientes.get(zona.mesa_id)
        if pendiente is not None:
            valor, desde = pendiente
            sostenido = segundos_video - desde
            # Solo se anuncia lo que todavía no está confirmado: si coincide con el
            # estado que ya se ve, no hay nada que esperar.
            hay_gente_ahora = estado == politica.OCUPADA
            if valor != hay_gente_ahora and sostenido < confirmacion:
                falta = confirmacion - sostenido
                texto += f"  ({'ocupando' if valor else 'liberando'} en {falta:.1f}s)"

        cv2.putText(frame, texto, (36, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)


def main():
    args = _parse_args()
    video = Path(args.video)
    if not video.exists():
        raise SystemExit(f"No existe el video: {video}")

    if args.rois:
        rois = json.loads(Path(args.rois).read_text(encoding="utf-8"))
    else:
        rois = _rois_desde_backend(args.camara)
    if not rois:
        raise SystemExit("No hay ROI activos para esa cámara.")
    if args.guardar_rois:
        Path(args.guardar_rois).write_text(json.dumps(rois, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("ROI guardados en %s", args.guardar_rois)

    zonas = zonas_mod.desde_rois(rois)
    nombres_mesa = {r["mesa_id"]: r.get("mesa_numero", r["mesa_id"]) for r in rois}

    modelo = (RAIZ / "models" / args.modelo) if args.modelo else config.YOLO_MODEL_PATH
    imgsz = args.imgsz or config.YOLO_IMGSZ
    confianza = args.confianza if args.confianza is not None else config.YOLO_CONFIDENCE
    overlap = args.overlap if args.overlap is not None else config.OVERLAP_MINIMO
    confirmacion = args.confirmacion if args.confirmacion is not None else config.CONFIRMACION_SEGUNDOS
    cada = args.cada_segundos or config.FRAME_INTERVAL_SECONDS

    captura = cv2.VideoCapture(str(video))
    if not captura.isOpened():
        raise SystemExit(f"No se pudo abrir el video: {video}")
    fps = captura.get(cv2.CAP_PROP_FPS) or 25.0
    ancho = int(captura.get(cv2.CAP_PROP_FRAME_WIDTH))
    alto = int(captura.get(cv2.CAP_PROP_FRAME_HEIGHT))

    salida = Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    escritor = cv2.VideoWriter(str(salida), cv2.VideoWriter_fourcc(*"mp4v"), fps, (ancho, alto))
    if not escritor.isOpened():
        raise SystemExit(f"No se pudo abrir el archivo de salida: {salida}")

    detector = Detector(modelo, confianza, config.YOLO_CLASSES, imgsz=imgsz)
    detector.load()
    confirmador = Confirmador(confirmacion)

    # Estado simulado de cada mesa. Arranca en libre porque la demo no consulta el
    # backend: lo que se muestra son las transiciones que el módulo pediría, aplicadas
    # sobre ese punto de partida.
    estados = {zona.mesa_id: politica.LIBRE for zona in zonas}

    print(f"\nVideo: {video.name} — {ancho}x{alto} @ {fps:.1f} fps")
    print(f"Modelo {Path(str(modelo)).name}, imgsz {imgsz}, confianza {confianza}")
    print(f"Overlap minimo {overlap}, confirmacion {confirmacion}s, deteccion cada {cada}s de video")
    print(f"ROI: {len(zonas)} zonas -> mesas {sorted(nombres_mesa.values())}\n")

    salto = max(1, round(fps * cada))
    detecciones = []
    indice = 0
    inferencias = 0
    cambios_totales = 0

    while True:
        ok, frame = captura.read()
        if not ok:
            break

        segundos_video = indice / fps

        if indice % salto == 0:
            detecciones = detector.detect(frame)
            inferencias += 1
            ocupacion = zonas_mod.resolver_ocupacion(zonas, detecciones, overlap, config.ANCLAJE_OVERLAP)
            # El reloj es el del video: así la confirmación tarda lo mismo que en vivo.
            cambios = confirmador.actualizar(ocupacion, segundos_video)
            for mesa_id, hay_gente in cambios.items():
                nuevo = politica.estado_objetivo(hay_gente, estados[mesa_id])
                if nuevo is not None:
                    print(
                        f"  t={segundos_video:6.1f}s  mesa {nombres_mesa.get(mesa_id, mesa_id)}: "
                        f"{estados[mesa_id]} -> {nuevo}"
                    )
                    estados[mesa_id] = nuevo
                    cambios_totales += 1

        _dibujar_zonas(frame, zonas, estados, nombres_mesa)
        _dibujar_detecciones(frame, detecciones)
        _dibujar_panel(
            frame, zonas, estados, nombres_mesa, confirmador._observado, segundos_video, confirmacion
        )
        escritor.write(frame)
        indice += 1

    captura.release()
    escritor.release()

    print(f"\n{indice} frames escritos en {salida}")
    print(f"{inferencias} inferencias, {cambios_totales} cambios de estado")
    print(
        "\nOjo al defender: el modulo NUNCA escribe 'libre'. Cuando los comensales se van la\n"
        "mesa pasa a 'pendiente_limpieza', y vuelve a libre cuando alguien la marca limpia.\n"
        "Es una decision de diseno, no un bug (ver app/mapping/politica.py)."
    )


if __name__ == "__main__":
    main()
