# Zonas (ROI) por mesa.
# Traduce las detecciones del frame a ocupación por mesa: cada zona es el
# polígono que ocupa una mesa dentro del frame de la cámara, y una mesa cuenta
# como ocupada cuando alguna detección se superpone lo suficiente con su zona.
#
# Los polígonos vienen del backend (`GET /roi-mesa/?camara_id=...`), que es la
# única fuente de verdad: acá no se lee ningún archivo local.

from app.utils.logger import get_logger

logger = get_logger(__name__)


class Zona:
    # mesa_id: id de la mesa en el backend
    # poligono: lista de puntos [(x, y), ...] en coordenadas del frame
    # roi_id: id de la fila en roi_mesa, para poder rastrear un ROI en el log
    def __init__(self, mesa_id, poligono, roi_id=None):
        self.mesa_id = mesa_id
        self.poligono = [(float(x), float(y)) for x, y in poligono]
        self.roi_id = roi_id

    def overlap(self, bbox):
        """Fracción del bounding box que cae dentro de la zona: área(∩)/área(bbox).

        Se mide contra el área del bbox y no contra la del ROI ni como IoU
        porque las dos figuras tienen tamaños muy distintos —una persona de pie
        ocupa una fracción del rectángulo de una mesa—, y un IoU las castigaría
        a las dos por igual dando siempre valores cercanos a cero. Preguntar
        "qué parte de esta persona está sobre la mesa" da un número que se puede
        umbralizar con sentido y que no depende del tamaño del ROI dibujado.
        """
        x1, y1, x2, y2 = bbox
        area_bbox = (x2 - x1) * (y2 - y1)
        if area_bbox <= 0:
            return 0.0
        return _area(_recortar(self.poligono, bbox)) / area_bbox

    def fuera_del_frame(self, ancho, alto):
        # El backend valida que las coordenadas no sean negativas pero no conoce
        # la resolución de la cámara, así que el límite superior se controla acá
        # (ver docs/camaras-roi.md). Devuelve los puntos que se salen del frame.
        return [(x, y) for x, y in self.poligono if x > ancho or y > alto]


def desde_rois(rois):
    """Construye las zonas a partir de la respuesta de `GET /roi-mesa/`."""
    return [Zona(roi["mesa_id"], roi["coordenadas"], roi_id=roi.get("id")) for roi in rois]


def resolver_ocupacion(zonas, detecciones, overlap_minimo):
    """Devuelve {mesa_id: bool} — si hay o no alguien sobre cada mesa en este frame.

    Es la lectura cruda del frame, sin memoria: confirmarla contra el umbral de
    tiempo sostenido es trabajo de mapping.confirmacion, y decidir qué estado
    escribir con esa lectura es trabajo de mapping.politica.
    """
    ocupacion = {}
    for zona in zonas:
        overlaps = [zona.overlap(deteccion.bbox) for deteccion in detecciones]
        maximo = max(overlaps, default=0.0)
        # Varias zonas pueden apuntar a la misma mesa (una mesa en el límite
        # entre dos ROI): alcanza con que una la vea ocupada.
        ocupacion[zona.mesa_id] = ocupacion.get(zona.mesa_id, False) or maximo >= overlap_minimo
        logger.debug(
            "Mesa %s (ROI %s): overlap máximo %.3f sobre %d detección(es)",
            zona.mesa_id,
            zona.roi_id,
            maximo,
            len(detecciones),
        )
    return ocupacion


def _recortar(poligono, bbox):
    """Recorta el polígono contra el rectángulo del bbox (Sutherland-Hodgman).

    El algoritmo pide que el recortante sea convexo, y un rectángulo lo es: se
    va cortando el polígono contra cada uno de sus cuatro lados, quedándose con
    lo que cae del lado de adentro y agregando el punto de corte cada vez que
    una arista cruza el borde. El resultado es exactamente el polígono de
    intersección, sin rasterizar nada ni sumar una dependencia como shapely.
    """
    # Cada borde como (a, b, c): adentro es el semiplano a*x + b*y + c >= 0.
    x1, y1, x2, y2 = bbox
    bordes = ((1, 0, -x1), (-1, 0, x2), (0, 1, -y1), (0, -1, y2))

    salida = list(poligono)
    for a, b, c in bordes:
        entrada, salida = salida, []
        if not entrada:
            break
        anterior = entrada[-1]
        distancia_anterior = a * anterior[0] + b * anterior[1] + c
        for actual in entrada:
            distancia_actual = a * actual[0] + b * actual[1] + c
            if distancia_actual >= 0:
                if distancia_anterior < 0:
                    salida.append(_corte(anterior, actual, distancia_anterior, distancia_actual))
                salida.append(actual)
            elif distancia_anterior >= 0:
                salida.append(_corte(anterior, actual, distancia_anterior, distancia_actual))
            anterior, distancia_anterior = actual, distancia_actual
    return salida


def _corte(p, q, distancia_p, distancia_q):
    # Punto donde el segmento p→q cruza el borde, interpolando por la distancia
    # con signo de cada extremo. El denominador nunca es cero: se llama solo
    # cuando los dos extremos están de lados distintos.
    t = distancia_p / (distancia_p - distancia_q)
    return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))


def _area(poligono):
    # Fórmula del cordón (shoelace), en valor absoluto para no depender del
    # sentido en el que se haya dibujado el polígono.
    if len(poligono) < 3:
        return 0.0
    suma = 0.0
    for (xa, ya), (xb, yb) in zip(poligono, poligono[1:] + poligono[:1]):
        suma += xa * yb - xb * ya
    return abs(suma) / 2
