# Pruebas de app.mapping.zonas: el overlap entre un bounding box y el polígono
# de un ROI, y la resolución de ocupación por mesa a partir de ese overlap.

import pytest

from app.detection.detector import Deteccion
from app.mapping.zonas import Zona, desde_rois, resolver_ocupacion

# Cuadrado de 100x100 con la esquina en (100, 100), como referencia de todas las
# pruebas de geometría.
CUADRADO = [(100, 100), (200, 100), (200, 200), (100, 200)]


class TestOverlap:
    def test_bbox_entero_dentro_de_la_zona(self):
        # Todo el bounding box cae adentro: la fracción es 1.
        zona = Zona(mesa_id=1, poligono=CUADRADO)
        assert zona.overlap((120, 120, 180, 180)) == pytest.approx(1.0)

    def test_bbox_entero_fuera_de_la_zona(self):
        zona = Zona(mesa_id=1, poligono=CUADRADO)
        assert zona.overlap((300, 300, 400, 400)) == pytest.approx(0.0)

    def test_bbox_a_medias(self):
        # 100 de ancho por 100 de alto, con la mitad izquierda fuera de la zona.
        zona = Zona(mesa_id=1, poligono=CUADRADO)
        assert zona.overlap((50, 100, 150, 200)) == pytest.approx(0.5)

    def test_bbox_apoyado_en_un_cuarto_de_la_zona(self):
        # Solo la esquina inferior derecha del bbox pisa la zona.
        zona = Zona(mesa_id=1, poligono=CUADRADO)
        assert zona.overlap((50, 50, 150, 150)) == pytest.approx(0.25)

    def test_zona_mas_chica_que_el_bbox(self):
        # Se mide contra el área del bbox: una persona alta sobre una mesa chica
        # da un overlap bajo aunque la zona esté enteramente cubierta.
        zona = Zona(mesa_id=1, poligono=CUADRADO)
        assert zona.overlap((0, 0, 400, 400)) == pytest.approx(10_000 / 160_000)

    def test_bbox_que_solo_toca_el_borde(self):
        zona = Zona(mesa_id=1, poligono=CUADRADO)
        assert zona.overlap((0, 100, 100, 200)) == pytest.approx(0.0)

    def test_bbox_sin_area(self):
        # Una caja degenerada no puede dar una fracción: se descarta con 0.
        zona = Zona(mesa_id=1, poligono=CUADRADO)
        assert zona.overlap((100, 100, 100, 200)) == pytest.approx(0.0)

    def test_el_sentido_del_poligono_no_cambia_el_resultado(self):
        # Los ROI los dibuja la UI y pueden venir en cualquier sentido.
        horario = Zona(mesa_id=1, poligono=CUADRADO)
        antihorario = Zona(mesa_id=1, poligono=list(reversed(CUADRADO)))
        assert horario.overlap((50, 100, 150, 200)) == pytest.approx(
            antihorario.overlap((50, 100, 150, 200))
        )

    def test_poligono_concavo(self):
        # Un ROI en L: el recorte tiene que respetar la escotadura y no el
        # rectángulo que la envuelve. El bbox cubre el cuadrante que le falta a
        # la L, así que la intersección es la mitad de sus 100x100.
        ele = [(0, 0), (200, 0), (200, 100), (100, 100), (100, 200), (0, 200)]
        zona = Zona(mesa_id=1, poligono=ele)
        assert zona.overlap((50, 50, 150, 150)) == pytest.approx(0.75)

    def test_triangulo(self):
        # Medio cuadrado de 100x100: 5000 sobre los 10000 del bbox.
        zona = Zona(mesa_id=1, poligono=[(0, 0), (100, 0), (0, 100)])
        assert zona.overlap((0, 0, 100, 100)) == pytest.approx(0.5)


class TestFueraDelFrame:
    def test_zona_dentro_del_frame(self):
        assert Zona(1, CUADRADO).fuera_del_frame(1280, 720) == []

    def test_devuelve_los_puntos_que_se_pasan(self):
        zona = Zona(1, [(100, 100), (1400, 100), (1400, 800), (100, 800)])
        excedidos = zona.fuera_del_frame(1280, 720)
        assert excedidos == [(1400.0, 100.0), (1400.0, 800.0), (100.0, 800.0)]


class TestDesdeRois:
    def test_construye_una_zona_por_roi(self):
        zonas = desde_rois(
            [
                {"id": 7, "mesa_id": 221, "coordenadas": [[0, 0], [10, 0], [10, 10]]},
                {"id": 8, "mesa_id": 222, "coordenadas": [[20, 20], [30, 20], [30, 30]]},
            ]
        )
        assert [(z.roi_id, z.mesa_id) for z in zonas] == [(7, 221), (8, 222)]
        assert zonas[0].poligono == [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]


class TestResolverOcupacion:
    def _deteccion(self, bbox):
        return Deteccion(bbox, clase=0, confianza=0.9)

    def test_sin_detecciones_todas_las_mesas_quedan_vacias(self):
        zonas = [Zona(1, CUADRADO), Zona(2, CUADRADO)]
        assert resolver_ocupacion(zonas, [], overlap_minimo=0.3) == {1: False, 2: False}

    def test_deteccion_por_encima_del_umbral_ocupa_la_mesa(self):
        zonas = [Zona(1, CUADRADO)]
        detecciones = [self._deteccion((120, 120, 180, 180))]
        assert resolver_ocupacion(zonas, detecciones, overlap_minimo=0.3) == {1: True}

    def test_deteccion_por_debajo_del_umbral_no_ocupa(self):
        # Overlap 0.25, por debajo del 0.3 configurado.
        zonas = [Zona(1, CUADRADO)]
        detecciones = [self._deteccion((50, 50, 150, 150))]
        assert resolver_ocupacion(zonas, detecciones, overlap_minimo=0.3) == {1: False}

    def test_el_umbral_es_inclusivo(self):
        zonas = [Zona(1, CUADRADO)]
        detecciones = [self._deteccion((50, 50, 150, 150))]
        assert resolver_ocupacion(zonas, detecciones, overlap_minimo=0.25) == {1: True}

    def test_alcanza_con_que_una_deteccion_supere_el_umbral(self):
        zonas = [Zona(1, CUADRADO)]
        detecciones = [self._deteccion((300, 300, 400, 400)), self._deteccion((120, 120, 180, 180))]
        assert resolver_ocupacion(zonas, detecciones, overlap_minimo=0.3) == {1: True}

    def test_cada_zona_se_evalua_por_separado(self):
        lejos = [(500, 500), (600, 500), (600, 600), (500, 600)]
        zonas = [Zona(1, CUADRADO), Zona(2, lejos)]
        detecciones = [self._deteccion((120, 120, 180, 180))]
        assert resolver_ocupacion(zonas, detecciones, overlap_minimo=0.3) == {1: True, 2: False}

    def test_dos_zonas_de_la_misma_mesa_se_combinan_con_or(self):
        # Una mesa puede tener ROI en más de una cámara o zonas partidas:
        # alcanza con que una la vea ocupada.
        lejos = [(500, 500), (600, 500), (600, 600), (500, 600)]
        zonas = [Zona(1, lejos, roi_id=10), Zona(1, CUADRADO, roi_id=11)]
        detecciones = [self._deteccion((120, 120, 180, 180))]
        assert resolver_ocupacion(zonas, detecciones, overlap_minimo=0.3) == {1: True}
