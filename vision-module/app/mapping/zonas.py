# Zonas (ROI) por mesa.
# Traduce las detecciones del frame a ocupación por mesa: cada zona es el
# polígono que ocupa una mesa dentro del frame de la cámara, y una mesa cuenta
# como ocupada cuando alguna detección se superpone lo suficiente con su zona.
#
# Los polígonos vienen del backend (`GET /roi-mesa/?camara_id=...`), que es la
# única fuente de verdad: acá no se lee ningún archivo local.

from app.utils.logger import get_logger

logger = get_logger(__name__)

# Qué parte del bounding box se compara contra el ROI (T26-180). Ver Zona.overlap.
ANCLAJE_BBOX_COMPLETO = "bbox_completo"
ANCLAJE_TERCIO_INFERIOR = "tercio_inferior"
ANCLAJES = (ANCLAJE_BBOX_COMPLETO, ANCLAJE_TERCIO_INFERIOR)

# Qué fracción de la altura del bbox se conserva con ANCLAJE_TERCIO_INFERIOR.
FRACCION_TERCIO_INFERIOR = 1 / 3


def _caja_de_anclaje(bbox, anclaje):
    """Recorta el bbox a la parte que se va a comparar contra el ROI."""
    if anclaje == ANCLAJE_BBOX_COMPLETO:
        return bbox
    if anclaje != ANCLAJE_TERCIO_INFERIOR:
        raise ValueError(f"Anclaje desconocido: {anclaje!r}. Válidos: {ANCLAJES}")

    x1, y1, x2, y2 = bbox
    alto = y2 - y1
    if alto <= 0:
        return bbox
    # y crece hacia abajo en coordenadas de imagen, así que el "tercio inferior"
    # arranca en y2 menos un tercio del alto.
    return (x1, y2 - alto * FRACCION_TERCIO_INFERIOR, x2, y2)


class Zona:
    # mesa_id: id de la mesa en el backend
    # poligono: lista de puntos [(x, y), ...] en coordenadas del frame
    # roi_id: id de la fila en roi_mesa, para poder rastrear un ROI en el log
    def __init__(self, mesa_id, poligono, roi_id=None):
        self.mesa_id = mesa_id
        self.poligono = [(float(x), float(y)) for x, y in poligono]
        self.roi_id = roi_id

    def overlap(self, bbox, anclaje=ANCLAJE_BBOX_COMPLETO):
        """Fracción del bounding box que cae dentro de la zona: área(∩)/área(caja).

        Se mide contra el área de la caja y no contra la del ROI ni como IoU
        porque las dos figuras tienen tamaños muy distintos —una persona de pie
        ocupa una fracción del rectángulo de una mesa—, y un IoU las castigaría
        a las dos por igual dando siempre valores cercanos a cero. Preguntar
        "qué parte de esta persona está sobre la mesa" da un número que se puede
        umbralizar con sentido y que no depende del tamaño del ROI dibujado.

        `anclaje` elige QUÉ parte de la persona se mide (T26-180):

        - ANCLAJE_BBOX_COMPLETO: el bbox entero, el criterio histórico.
        - ANCLAJE_TERCIO_INFERIOR: solo el tercio de abajo. El bbox de una persona
          es alto y angosto, y según el ángulo de la cámara buena parte cae por
          ENCIMA de la mesa en el plano de la imagen, no sobre ella; con una cámara
          baja o lateral, alguien perfectamente sentado puede quedar bastante por
          debajo del umbral. Mirar dónde está apoyada la persona en vez de dónde
          tiene la cabeza es más robusto frente al ángulo y frente a personas de
          distinta altura.

        Cuál conviene depende del montaje real de la cámara y todavía NO está
        medido: hace falta una escena con gente sentada a mesas de verdad. Por eso
        el default sigue siendo el criterio histórico — cambiarlo a ciegas movería
        todas las decisiones de ocupación sin evidencia.
        """
        caja = _caja_de_anclaje(bbox, anclaje)
        x1, y1, x2, y2 = caja
        area_caja = (x2 - x1) * (y2 - y1)
        if area_caja <= 0:
            return 0.0
        return _area(_recortar(self.poligono, caja)) / area_caja

    def fuera_del_frame(self, ancho, alto):
        # El backend valida que las coordenadas no sean negativas pero no conoce
        # la resolución de la cámara, así que el límite superior se controla acá
        # (ver docs/camaras-roi.md). Devuelve los puntos que se salen del frame.
        return [(x, y) for x, y in self.poligono if x > ancho or y > alto]


def desde_rois(rois):
    """Construye las zonas a partir de la respuesta de `GET /roi-mesa/`."""
    return [Zona(roi["mesa_id"], roi["coordenadas"], roi_id=roi.get("id")) for roi in rois]


def resolver_ocupacion(zonas, detecciones, overlap_minimo, anclaje=ANCLAJE_BBOX_COMPLETO):
    """Devuelve {mesa_id: bool} — si hay o no alguien sobre cada mesa en este frame.

    Es la lectura cruda del frame, sin memoria: confirmarla contra el umbral de
    tiempo sostenido es trabajo de mapping.confirmacion, y decidir qué estado
    escribir con esa lectura es trabajo de mapping.politica.

    `anclaje` se pasa tal cual a Zona.overlap: define qué parte de la persona se
    compara contra el ROI (T26-180).
    """
    ocupacion = {}
    for zona in zonas:
        overlaps = [zona.overlap(deteccion.bbox, anclaje) for deteccion in detecciones]
        maximo = max(overlaps, default=0.0)
        # Varias zonas pueden apuntar a la misma mesa (una mesa en el límite
        # entre dos ROI): alcanza con que una la vea ocupada.
        ocupacion[zona.mesa_id] = ocupacion.get(zona.mesa_id, False) or maximo >= overlap_minimo
        logger.debug(
            "Mesa %s (ROI %s): overlap máximo %.3f sobre %d detección(es) [anclaje %s]",
            zona.mesa_id,
            zona.roi_id,
            maximo,
            len(detecciones),
            anclaje,
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
