# Zonas (ROI) por mesa.
# Traduce las detecciones del frame al estado de cada mesa: cada zona es un
# polígono asociado a una mesa del backend, y una mesa se considera ocupada
# cuando hay detecciones dentro de su zona.

import json

from app.utils.logger import get_logger

logger = get_logger(__name__)


class Zona:
    # mesa_id: id de la mesa en el backend
    # poligono: lista de puntos [(x, y), ...] en coordenadas del frame
    def __init__(self, mesa_id, poligono):
        self.mesa_id = mesa_id
        self.poligono = poligono

    def contiene(self, punto):
        # Indica si un punto (x, y) cae dentro del polígono de la zona.
        raise NotImplementedError


def cargar_zonas(ruta):
    # Lee el archivo de zonas (ver config/zonas.example.json) y devuelve [Zona].
    with open(ruta, encoding="utf-8") as archivo:
        datos = json.load(archivo)
    return [Zona(z["mesa_id"], [tuple(p) for p in z["poligono"]]) for z in datos["zonas"]]


def resolver_estados(zonas, detecciones):
    # Devuelve {mesa_id: estado} a partir de las detecciones del frame.
    # Los estados válidos son los del backend: libre, ocupada, pendiente_limpieza,
    # reservada. El módulo de visión solo decide entre libre y ocupada; las
    # transiciones a pendiente_limpieza y reservada son responsabilidad del backend.
    raise NotImplementedError
