# Pruebas de app.main: el armado del pipeline (qué cámara, qué ROI, qué fuente
# de video) y el comportamiento del bucle ante frames perdidos y errores de la API.

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app import config, main
from app.client.backend_client import CredencialesInvalidas, ErrorBackend
from app.mapping.confirmacion import Confirmador

CAMARA = {"id": 2, "nombre": "Salón", "rtsp_url": "rtsp://admin:***@192.168.1.11:554/x"}


def cliente_falso(camaras=(), rois=(), mesas=()):
    cliente = MagicMock()
    cliente.listar_camaras.return_value = list(camaras)
    cliente.listar_rois.return_value = list(rois)
    cliente.listar_mesas.return_value = list(mesas)
    return cliente


class TestValidarConfiguracion:
    def test_falta_una_variable_obligatoria(self, monkeypatch):
        monkeypatch.setattr(config, "BACKEND_EMAIL", None)
        monkeypatch.setattr(config, "BACKEND_PASSWORD", "x")
        monkeypatch.setattr(config, "SECTOR_ID", 2)

        with pytest.raises(main.ConfiguracionInvalida, match="BACKEND_EMAIL"):
            main.validar_configuracion()

    def test_lista_todas_las_que_faltan(self, monkeypatch):
        monkeypatch.setattr(config, "BACKEND_EMAIL", None)
        monkeypatch.setattr(config, "BACKEND_PASSWORD", None)
        monkeypatch.setattr(config, "SECTOR_ID", None)

        with pytest.raises(main.ConfiguracionInvalida) as error:
            main.validar_configuracion()
        assert "BACKEND_EMAIL, BACKEND_PASSWORD, SECTOR_ID" in str(error.value)

    @pytest.mark.parametrize("valor", [0, 1.5, -0.2])
    def test_overlap_fuera_de_rango(self, monkeypatch, valor):
        monkeypatch.setattr(config, "BACKEND_EMAIL", "a@b.com")
        monkeypatch.setattr(config, "BACKEND_PASSWORD", "x")
        monkeypatch.setattr(config, "SECTOR_ID", 2)
        monkeypatch.setattr(config, "OVERLAP_MINIMO", valor)

        with pytest.raises(main.ConfiguracionInvalida, match="OVERLAP_MINIMO"):
            main.validar_configuracion()


class TestSeleccionarCamara:
    def test_sector_sin_camaras(self):
        with pytest.raises(main.ConfiguracionInvalida, match="no tiene cámaras activas"):
            main.seleccionar_camara(cliente_falso(), sector_id=2, camara_id=None)

    def test_una_sola_camara_se_toma_sola(self):
        cliente = cliente_falso(camaras=[CAMARA])
        assert main.seleccionar_camara(cliente, sector_id=2, camara_id=None) == CAMARA
        cliente.listar_camaras.assert_called_once_with(sector_id=2)

    def test_varias_camaras_sin_elegir_una(self):
        # No se elige por omisión: sería procesar en silencio una parte del sector.
        cliente = cliente_falso(camaras=[CAMARA, {"id": 3, "nombre": "Cocina"}])
        with pytest.raises(main.ConfiguracionInvalida) as error:
            main.seleccionar_camara(cliente, sector_id=2, camara_id=None)
        assert "CAMARA_ID" in str(error.value)
        assert "2 (Salón)" in str(error.value) and "3 (Cocina)" in str(error.value)

    def test_varias_camaras_con_camara_id(self):
        cliente = cliente_falso(camaras=[CAMARA, {"id": 3, "nombre": "Cocina"}])
        assert main.seleccionar_camara(cliente, sector_id=2, camara_id=3)["id"] == 3

    def test_camara_id_que_no_es_del_sector(self):
        cliente = cliente_falso(camaras=[CAMARA])
        with pytest.raises(main.ConfiguracionInvalida, match="no está activa en el sector"):
            main.seleccionar_camara(cliente, sector_id=2, camara_id=99)


class TestCargarZonas:
    def test_camara_sin_rois(self):
        with pytest.raises(main.ConfiguracionInvalida, match="no tiene ROI activos"):
            main.cargar_zonas(cliente_falso(), CAMARA, sector_id=2)

    def test_arma_una_zona_por_roi(self):
        cliente = cliente_falso(
            rois=[{"id": 7, "mesa_id": 221, "coordenadas": [[0, 0], [10, 0], [10, 10]]}],
            mesas=[{"id": 221, "numero": 6}],
        )
        zonas = main.cargar_zonas(cliente, CAMARA, sector_id=2)

        assert [(z.roi_id, z.mesa_id) for z in zonas] == [(7, 221)]
        cliente.listar_rois.assert_called_once_with(2)

    def test_descarta_el_roi_de_una_mesa_que_no_esta_en_el_sector(self):
        # La mesa pudo darse de baja o moverse de sector sin tocar el ROI.
        cliente = cliente_falso(
            rois=[
                {"id": 7, "mesa_id": 221, "coordenadas": [[0, 0], [10, 0], [10, 10]]},
                {"id": 8, "mesa_id": 999, "coordenadas": [[0, 0], [10, 0], [10, 10]]},
            ],
            mesas=[{"id": 221, "numero": 6}],
        )
        zonas = main.cargar_zonas(cliente, CAMARA, sector_id=2)
        assert [z.mesa_id for z in zonas] == [221]

    def test_si_no_queda_ningun_roi_valido_no_arranca(self):
        cliente = cliente_falso(
            rois=[{"id": 8, "mesa_id": 999, "coordenadas": [[0, 0], [10, 0], [10, 10]]}],
            mesas=[{"id": 221, "numero": 6}],
        )
        with pytest.raises(main.ConfiguracionInvalida, match="Ninguno de los 1 ROI"):
            main.cargar_zonas(cliente, CAMARA, sector_id=2)


class TestResolverFuente:
    def test_video_source_pisa_la_camara_del_backend(self, monkeypatch):
        monkeypatch.setattr(config, "VIDEO_SOURCE", 0)
        assert main.resolver_fuente(CAMARA) == 0

    def test_completa_la_password_que_la_api_no_devuelve(self, monkeypatch):
        monkeypatch.setattr(config, "VIDEO_SOURCE", None)
        monkeypatch.setattr(config, "CAMARA_PASSWORD", "secreta")
        assert main.resolver_fuente(CAMARA) == "rtsp://admin:secreta@192.168.1.11:554/x"

    def test_sin_camara_password_no_arranca(self, monkeypatch):
        monkeypatch.setattr(config, "VIDEO_SOURCE", None)
        monkeypatch.setattr(config, "CAMARA_PASSWORD", None)
        with pytest.raises(main.ConfiguracionInvalida, match="CAMARA_PASSWORD"):
            main.resolver_fuente(CAMARA)

    def test_camara_sin_credenciales_se_usa_tal_cual(self, monkeypatch):
        monkeypatch.setattr(config, "VIDEO_SOURCE", None)
        camara = {"id": 2, "nombre": "Salón", "rtsp_url": "rtsp://192.168.1.11:554/x"}
        assert main.resolver_fuente(camara) == "rtsp://192.168.1.11:554/x"


class TestAvisarZonasFueraDelFrame:
    def test_avisa_cuando_el_roi_se_sale_del_frame(self, caplog):
        from app.mapping.zonas import Zona

        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        main.avisar_zonas_fuera_del_frame([Zona(1, [(0, 0), (1400, 0), (1400, 100)], roi_id=7)], frame)
        assert "fuera del frame" in caplog.text

    def test_no_avisa_si_entra_entero(self, caplog):
        from app.mapping.zonas import Zona

        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        main.avisar_zonas_fuera_del_frame([Zona(1, [(0, 0), (100, 0), (100, 100)])], frame)
        assert caplog.text == ""


class TestAplicarCambio:
    def test_escribe_el_estado_que_dicta_la_politica(self):
        cliente = MagicMock()
        cliente.obtener_mesa.return_value = {"id": 221, "numero": 6, "estado": "libre"}

        main.aplicar_cambio(cliente, Confirmador(6), mesa_id=221, hay_gente=True)

        cliente.cambiar_estado.assert_called_once_with(221, "ocupada")

    def test_no_toca_la_mesa_si_la_politica_no_lo_permite(self):
        cliente = MagicMock()
        cliente.obtener_mesa.return_value = {"id": 221, "numero": 6, "estado": "reservada"}

        main.aplicar_cambio(cliente, Confirmador(6), mesa_id=221, hay_gente=False)

        cliente.cambiar_estado.assert_not_called()

    def test_relee_el_estado_antes_de_decidir(self):
        # Un mozo pudo tocar la mesa entre dos cambios.
        cliente = MagicMock()
        cliente.obtener_mesa.return_value = {"id": 221, "numero": 6, "estado": "ocupada"}

        main.aplicar_cambio(cliente, Confirmador(6), mesa_id=221, hay_gente=False)

        cliente.obtener_mesa.assert_called_once_with(221)
        cliente.cambiar_estado.assert_called_once_with(221, "pendiente_limpieza")

    def test_un_error_de_la_api_deja_el_cambio_para_reintentar(self):
        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = ErrorBackend("timeout")
        confirmador = MagicMock()

        main.aplicar_cambio(cliente, confirmador, mesa_id=221, hay_gente=True)

        confirmador.revertir.assert_called_once_with(221)

    def test_un_problema_de_permisos_corta_el_pipeline(self):
        # Reintentar un 403 no lo arregla: hay que revisar el rol del usuario.
        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = CredencialesInvalidas("rol insuficiente")

        with pytest.raises(CredencialesInvalidas):
            main.aplicar_cambio(cliente, Confirmador(6), mesa_id=221, hay_gente=True)


class TestPublicarDeteccionActual:
    def _deteccion(self, bbox=(10.0, 20.0, 30.0, 40.0), clase=0, confianza=0.9):
        deteccion = MagicMock()
        deteccion.bbox = bbox
        deteccion.clase = clase
        deteccion.confianza = confianza
        return deteccion

    def test_arma_el_payload_con_el_nombre_de_clase_del_modelo(self):
        cliente = MagicMock()
        detector = MagicMock()
        detector.model.names = {0: "person"}
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        main.publicar_deteccion_actual(cliente, camara_id=2, detector=detector, detecciones=[self._deteccion()], frame=frame)

        cliente.publicar_deteccion_actual.assert_called_once()
        camara_id, payload = cliente.publicar_deteccion_actual.call_args.args
        assert camara_id == 2
        assert payload["source_id"] == "2"
        assert payload["frame_width"] == 640
        assert payload["frame_height"] == 480
        assert payload["detections"][0]["class_name"] == "person"
        assert payload["detections"][0]["class_id"] == 0
        assert payload["detections"][0]["bbox"] == {"x1": 10, "y1": 20, "x2": 30, "y2": 40}

    def test_clase_ausente_del_modelo_cae_al_indice_como_texto(self):
        # Mismo fallback que scripts/test_condiciones.py:_nombre_clase.
        cliente = MagicMock()
        detector = MagicMock()
        detector.model.names = {}
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        main.publicar_deteccion_actual(
            cliente, camara_id=2, detector=detector, detecciones=[self._deteccion(clase=99)], frame=frame
        )

        payload = cliente.publicar_deteccion_actual.call_args.args[1]
        assert payload["detections"][0]["class_name"] == "99"

    def test_un_fallo_de_red_al_publicar_no_propaga(self, caplog):
        cliente = MagicMock()
        cliente.publicar_deteccion_actual.side_effect = ErrorBackend("backend caído")
        detector = MagicMock()
        detector.model.names = {}
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        main.publicar_deteccion_actual(cliente, camara_id=2, detector=detector, detecciones=[], frame=frame)

        assert "No se pudo publicar la detección" in caplog.text

    def test_un_bbox_invalido_tampoco_propaga(self, caplog):
        # x2 <= x1: DetectionBox lo rechaza con ValidationError, no con
        # ErrorBackend — el catch de publicar_deteccion_actual es amplio a
        # propósito y tiene que cubrir esto también, no solo fallos de red.
        cliente = MagicMock()
        detector = MagicMock()
        detector.model.names = {0: "person"}
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        main.publicar_deteccion_actual(
            cliente,
            camara_id=2,
            detector=detector,
            detecciones=[self._deteccion(bbox=(10.0, 20.0, 10.0, 40.0))],
            frame=frame,
        )

        cliente.publicar_deteccion_actual.assert_not_called()
        assert "No se pudo publicar la detección" in caplog.text


class TestBucle:
    def _video(self, frames):
        video = MagicMock()
        video.read_frame.side_effect = list(frames) + [KeyboardInterrupt]
        return video

    def _detector(self, detecciones=()):
        detector = MagicMock()
        detector.detect.return_value = list(detecciones)
        return detector

    def _correr(self, video, detector, zonas, confirmador, cliente=None):
        cliente = cliente if cliente is not None else cliente_falso()
        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(video, detector, cliente, zonas, confirmador, CAMARA["id"])
        return cliente

    def test_un_frame_perdido_no_cuenta_como_mesa_vacia(self, monkeypatch):
        # Sin imagen no se observa nada: el reloj de confirmación no se toca.
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "FRAMES_FALLIDOS_MAXIMOS", 99)
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}

        self._correr(self._video([None, None]), self._detector(), [Zona(1, [(0, 0), (1, 0), (1, 1)])], confirmador)

        confirmador.actualizar.assert_not_called()

    def test_reconecta_al_acumular_frames_perdidos(self, monkeypatch):
        monkeypatch.setattr(config, "FRAMES_FALLIDOS_MAXIMOS", 2)
        video = self._video([None, None])

        with patch("app.main.reconectar") as reconectar:
            self._correr(video, self._detector(), [], MagicMock(actualizar=MagicMock(return_value={})))

        reconectar.assert_called_once_with(video)

    def test_un_frame_valido_alimenta_la_confirmacion(self, monkeypatch):
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        self._correr(self._video([frame]), self._detector(), [Zona(1, [(0, 0), (10, 0), (10, 10)])], confirmador)

        assert confirmador.actualizar.call_args.args[0] == {1: False}

    def test_un_fallo_al_publicar_la_deteccion_no_frena_el_cambio_de_estado(self, monkeypatch):
        # La garantía más importante de T26-150: un POST de detección caído (ej.
        # backend abajo, o cualquier otro ErrorBackend) nunca tiene que impedir
        # que se confirme y aplique un cambio de estado de mesa — es información
        # secundaria, la detección de ocupación es la función principal.
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = cliente_falso()
        cliente.publicar_deteccion_actual.side_effect = ErrorBackend("backend caído")
        cliente.obtener_mesa.return_value = {"id": 1, "numero": 1, "estado": "libre"}
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {1: True}
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        self._correr(
            self._video([frame]),
            self._detector(),
            [Zona(1, [(0, 0), (10, 0), (10, 10)])],
            confirmador,
            cliente=cliente,
        )

        cliente.publicar_deteccion_actual.assert_called_once()
        confirmador.actualizar.assert_called_once()
        cliente.cambiar_estado.assert_called_once_with(1, "ocupada")
