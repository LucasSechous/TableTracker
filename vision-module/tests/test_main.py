# Pruebas de app.main: el armado del pipeline (qué cámara, qué ROI, qué fuente
# de video) y el comportamiento del bucle ante frames perdidos y errores de la API.

import threading
import time
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


class TestPublicadorEnSegundoPlano:
    # T26-181 midió que ese POST costaba una mediana de 672 ms dentro del ciclo, tanto
    # como la inferencia de YOLO, para información que es secundaria. Sacarlo del camino
    # crítico recupera un tercio del presupuesto de 2 s.

    def test_no_bloquea_al_llamador(self):
        import time as _time

        arrancado = threading.Event()
        soltar = threading.Event()

        def lento(*_args):
            arrancado.set()
            soltar.wait(5)

        publicador = main.PublicadorEnSegundoPlano()
        with patch.object(main, "publicar_deteccion_actual", side_effect=lento):
            t0 = _time.monotonic()
            publicador.publicar(MagicMock(), 5, MagicMock(), [], np.zeros((2, 2, 3)))
            transcurrido = _time.monotonic() - t0
            assert arrancado.wait(2), "el envío tendría que haber arrancado en su propio hilo"
            assert transcurrido < 0.5, "publicar() no puede bloquear el ciclo"
            soltar.set()

    def test_saltea_el_frame_si_el_envio_anterior_sigue_en_curso(self):
        # Encolar publicaría fotos viejas en una vista que se llama "en vivo", y una
        # cola sin límite crecería si el backend se pone lento. Se descarta a propósito.
        soltar = threading.Event()
        llamadas = []

        def lento(*args):
            llamadas.append(args)
            soltar.wait(5)

        publicador = main.PublicadorEnSegundoPlano()
        with patch.object(main, "publicar_deteccion_actual", side_effect=lento):
            publicador.publicar(MagicMock(), 5, MagicMock(), [], np.zeros((2, 2, 3)))
            for _ in range(50):
                if llamadas:
                    break
                threading.Event().wait(0.01)
            publicador.publicar(MagicMock(), 5, MagicMock(), [], np.zeros((2, 2, 3)))
            publicador.publicar(MagicMock(), 5, MagicMock(), [], np.zeros((2, 2, 3)))
            assert len(llamadas) == 1, "los frames de más se descartan, no se encolan"
            soltar.set()

    def test_vuelve_a_publicar_cuando_el_anterior_termino(self):
        publicador = main.PublicadorEnSegundoPlano()
        with patch.object(main, "publicar_deteccion_actual") as fake:
            publicador.publicar(MagicMock(), 5, MagicMock(), [], np.zeros((2, 2, 3)))
            publicador._hilo.join(timeout=2)
            publicador.publicar(MagicMock(), 5, MagicMock(), [], np.zeros((2, 2, 3)))
            publicador._hilo.join(timeout=2)
        assert fake.call_count == 2


class TestRegistrarPresupuesto:
    def test_avisa_cuando_el_ciclo_se_pasa_del_presupuesto(self, caplog):
        # Sin este aviso, un ciclo que se pasa no duerme nada y la cadencia se degrada
        # en silencio: desde afuera se ve igual que "la detección va lenta".
        inicio = time.monotonic() - (config.FRAME_INTERVAL_SECONDS + 1.0)
        with caplog.at_level("WARNING"):
            main.registrar_presupuesto(inicio, {"inferencia": 0.8, "publicar": 0.001})
        assert "se pasó" in caplog.text
        assert "inferencia 800ms" in caplog.text

    def test_en_un_ciclo_normal_no_ensucia_el_log(self, caplog):
        inicio = time.monotonic() - 0.2
        with caplog.at_level("WARNING"):
            main.registrar_presupuesto(inicio, {"inferencia": 0.2})
        assert caplog.text == ""


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
        """Corre el bucle hasta el KeyboardInterrupt y espera a que se apliquen los cambios.

        Desde T26-183 los cambios de estado no se aplican dentro del ciclo sino en los
        workers del aplicador, así que un assert inmediato después del bucle correría
        antes de que el trabajo termine. El aplicador se inyecta con un solo hilo para
        que el orden sea determinista y se drena acá.
        """
        cliente = cliente if cliente is not None else cliente_falso()
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=1)
        try:
            with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
                main.bucle(video, detector, cliente, zonas, confirmador, CAMARA["id"], aplicador=aplicador)
            limite = time.monotonic() + 5
            while aplicador.pendientes() > 0 and time.monotonic() < limite:
                time.sleep(0.01)
            assert aplicador.pendientes() == 0, "el aplicador no drenó a tiempo"
        finally:
            aplicador.cerrar()
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


class TestCacheUmbrales:
    # T26-183: los dos parámetros que antes vivían en el .env de vision-module.

    def test_no_llama_a_la_api_antes_de_la_iteracion_n(self):
        cliente = MagicMock()
        umbrales = main.CacheUmbrales(cliente, confirmacion_segundos=6, overlap_minimo=0.3, cada_iteraciones=3)

        umbrales.actualizar()
        umbrales.actualizar()

        cliente.obtener_configuracion.assert_not_called()

    def test_llama_a_la_api_en_la_iteracion_n(self):
        cliente = MagicMock()
        cliente.obtener_configuracion.return_value = {"confirmacion_segundos": 6, "overlap_minimo": 0.3}
        umbrales = main.CacheUmbrales(cliente, confirmacion_segundos=6, overlap_minimo=0.3, cada_iteraciones=3)

        for _ in range(3):
            umbrales.actualizar()

        cliente.obtener_configuracion.assert_called_once()

    def test_actualiza_los_valores_con_lo_que_devuelve_la_api(self):
        cliente = MagicMock()
        cliente.obtener_configuracion.return_value = {"confirmacion_segundos": 10, "overlap_minimo": 0.5}
        umbrales = main.CacheUmbrales(cliente, confirmacion_segundos=6, overlap_minimo=0.3, cada_iteraciones=1)

        umbrales.actualizar()

        assert umbrales.confirmacion_segundos == 10
        assert umbrales.overlap_minimo == 0.5

    def test_avisa_en_el_log_cuando_un_valor_cambia(self, caplog):
        cliente = MagicMock()
        cliente.obtener_configuracion.return_value = {"confirmacion_segundos": 10, "overlap_minimo": 0.3}
        umbrales = main.CacheUmbrales(cliente, confirmacion_segundos=6, overlap_minimo=0.3, cada_iteraciones=1)

        with caplog.at_level("WARNING"):
            umbrales.actualizar()

        assert "CONFIRMACION_SEGUNDOS cambió de 6 a 10" in caplog.text
        assert "OVERLAP_MINIMO" not in caplog.text

    def test_no_avisa_si_no_cambio_nada(self, caplog):
        cliente = MagicMock()
        cliente.obtener_configuracion.return_value = {"confirmacion_segundos": 6, "overlap_minimo": 0.3}
        umbrales = main.CacheUmbrales(cliente, confirmacion_segundos=6, overlap_minimo=0.3, cada_iteraciones=1)

        with caplog.at_level("WARNING"):
            umbrales.actualizar()

        assert caplog.text == ""

    def test_un_fallo_de_la_api_mantiene_el_ultimo_valor_conocido(self, caplog):
        cliente = MagicMock()
        cliente.obtener_configuracion.side_effect = ErrorBackend("backend caído")
        umbrales = main.CacheUmbrales(cliente, confirmacion_segundos=6, overlap_minimo=0.3, cada_iteraciones=1)

        with caplog.at_level("WARNING"):
            umbrales.actualizar()

        assert umbrales.confirmacion_segundos == 6
        assert umbrales.overlap_minimo == 0.3
        assert "No se pudo refrescar la configuración" in caplog.text


class TestCacheZonas:
    # T26-199: antes de esto, cargar_zonas() se llamaba una sola vez al arrancar y una
    # mesa/sector dado de baja en pleno funcionamiento no se reflejaba hasta reiniciar.

    def test_no_llama_a_la_api_antes_de_la_iteracion_n(self):
        cliente = cliente_falso()
        cache = main.CacheZonas(cliente, CAMARA, sector_id=2, confirmador=MagicMock(), zonas_iniciales=[], cada_iteraciones=3)

        cache.actualizar()
        cache.actualizar()

        cliente.listar_rois.assert_not_called()

    def test_llama_a_la_api_en_la_iteracion_n(self):
        cliente = cliente_falso(
            rois=[{"id": 7, "mesa_id": 221, "coordenadas": [[0, 0], [10, 0], [10, 10]]}],
            mesas=[{"id": 221, "numero": 6}],
        )
        cache = main.CacheZonas(cliente, CAMARA, sector_id=2, confirmador=MagicMock(), zonas_iniciales=[], cada_iteraciones=3)

        for _ in range(3):
            cache.actualizar()

        cliente.listar_rois.assert_called_once_with(CAMARA["id"])

    def test_actualiza_las_zonas_con_lo_que_devuelve_la_api(self):
        cliente = cliente_falso(
            rois=[{"id": 7, "mesa_id": 221, "coordenadas": [[0, 0], [10, 0], [10, 10]]}],
            mesas=[{"id": 221, "numero": 6}],
        )
        cache = main.CacheZonas(cliente, CAMARA, sector_id=2, confirmador=MagicMock(), zonas_iniciales=[], cada_iteraciones=1)

        cache.actualizar()

        assert [z.mesa_id for z in cache.zonas] == [221]

    def test_avisa_al_confirmador_que_mesas_siguen_vigentes(self):
        # Es lo que hace que una mesa dada de baja deje de arrastrar su observación
        # vieja: sin esto, Confirmador la resucitaría con un reloj que arrancó hace rato.
        cliente = cliente_falso(
            rois=[{"id": 7, "mesa_id": 221, "coordenadas": [[0, 0], [10, 0], [10, 10]]}],
            mesas=[{"id": 221, "numero": 6}],
        )
        confirmador = MagicMock()
        cache = main.CacheZonas(cliente, CAMARA, sector_id=2, confirmador=confirmador, zonas_iniciales=[], cada_iteraciones=1)

        cache.actualizar()

        confirmador.olvidar.assert_called_once_with([221])

    def test_un_fallo_de_la_api_mantiene_las_ultimas_zonas_conocidas(self, caplog):
        from app.mapping.zonas import Zona

        cliente = cliente_falso()
        cliente.listar_rois.side_effect = ErrorBackend("backend caído")
        confirmador = MagicMock()
        anteriores = [Zona(221, [(0, 0), (10, 0), (10, 10)], roi_id=7)]
        cache = main.CacheZonas(cliente, CAMARA, sector_id=2, confirmador=confirmador, zonas_iniciales=anteriores, cada_iteraciones=1)

        with caplog.at_level("WARNING"):
            cache.actualizar()

        assert cache.zonas is anteriores
        confirmador.olvidar.assert_not_called()
        assert "No se pudo refrescar las zonas" in caplog.text

    def test_si_todas_las_mesas_quedaron_inactivas_mantiene_las_ultimas_zonas_conocidas(self, caplog):
        from app.mapping.zonas import Zona

        # Ningún ROI apunta a una mesa vigente del sector: cargar_zonas() levanta
        # ConfiguracionInvalida, igual que al arrancar — pero acá el proceso ya está
        # corriendo y no tiene por qué cortarse por eso.
        cliente = cliente_falso(
            rois=[{"id": 8, "mesa_id": 999, "coordenadas": [[0, 0], [10, 0], [10, 10]]}],
            mesas=[{"id": 221, "numero": 6}],
        )
        confirmador = MagicMock()
        anteriores = [Zona(221, [(0, 0), (10, 0), (10, 10)], roi_id=7)]
        cache = main.CacheZonas(cliente, CAMARA, sector_id=2, confirmador=confirmador, zonas_iniciales=anteriores, cada_iteraciones=1)

        with caplog.at_level("ERROR"):
            cache.actualizar()

        assert cache.zonas is anteriores
        confirmador.olvidar.assert_not_called()
        assert "No se pudieron refrescar las zonas" in caplog.text


class TestCargarUmbralesIniciales:
    def test_usa_lo_que_devuelve_la_api(self):
        cliente = MagicMock()
        cliente.obtener_configuracion.return_value = {"confirmacion_segundos": 10, "overlap_minimo": 0.5}

        umbrales = main.cargar_umbrales_iniciales(cliente)

        assert umbrales.confirmacion_segundos == 10
        assert umbrales.overlap_minimo == 0.5

    def test_cae_al_env_si_la_api_no_responde_al_arrancar(self, monkeypatch, caplog):
        monkeypatch.setattr(config, "CONFIRMACION_SEGUNDOS", 6)
        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = MagicMock()
        cliente.obtener_configuracion.side_effect = ErrorBackend("backend caído")

        with caplog.at_level("WARNING"):
            umbrales = main.cargar_umbrales_iniciales(cliente)

        assert umbrales.confirmacion_segundos == 6
        assert umbrales.overlap_minimo == 0.3
        assert "se usan los valores del .env" in caplog.text

    def test_usa_la_cadencia_de_refresco_configurada(self, monkeypatch):
        monkeypatch.setattr(config, "CONFIGURACION_REFRESCO_ITERACIONES", 7)
        cliente = MagicMock()
        cliente.obtener_configuracion.return_value = {"confirmacion_segundos": 6, "overlap_minimo": 0.3}

        umbrales = main.cargar_umbrales_iniciales(cliente)

        assert umbrales.cada_iteraciones == 7


class TestBucleConUmbrales:
    def _video(self, frames):
        video = MagicMock()
        video.read_frame.side_effect = list(frames) + [KeyboardInterrupt]
        return video

    def test_el_bucle_refresca_los_umbrales_en_cada_iteracion(self, monkeypatch):
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = cliente_falso()
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}
        umbrales = MagicMock()
        umbrales.confirmacion_segundos = 6
        umbrales.overlap_minimo = 0.3
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(
                self._video([frame]),
                MagicMock(detect=MagicMock(return_value=[])),
                cliente,
                [Zona(1, [(0, 0), (10, 0), (10, 10)])],
                confirmador,
                CAMARA["id"],
                umbrales=umbrales,
            )

        # Una vez por el frame real y otra en la iteración que corta con KeyboardInterrupt:
        # umbrales.actualizar() se llama al principio de CADA vuelta del bucle, antes de leer
        # el frame, así que la cuenta incluye la iteración que aborta.
        assert umbrales.actualizar.call_count == 2

    def test_el_bucle_usa_el_overlap_minimo_de_los_umbrales_y_no_el_del_env(self, monkeypatch):
        from app.mapping.zonas import Zona

        # OVERLAP_MINIMO del .env queda alto a propósito: si el bucle lo usara en vez del
        # de umbrales, la zona nunca se marcaría ocupada y el test lo detectaría.
        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.99)
        cliente = cliente_falso()
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}
        umbrales = MagicMock()
        umbrales.confirmacion_segundos = 6
        umbrales.overlap_minimo = 0.1
        # Detección que cubre la zona entera: con overlap_minimo=0.1 cuenta como ocupada.
        deteccion = MagicMock(bbox=(0, 0, 10, 10))
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(
                self._video([frame]),
                MagicMock(detect=MagicMock(return_value=[deteccion])),
                cliente,
                [Zona(1, [(0, 0), (10, 0), (10, 10)])],
                confirmador,
                CAMARA["id"],
                umbrales=umbrales,
            )

        assert confirmador.actualizar.call_args.args[0] == {1: True}

    def test_el_bucle_sincroniza_confirmador_segundos_con_umbrales(self, monkeypatch):
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = cliente_falso()
        confirmador = Confirmador(segundos=6)
        umbrales = MagicMock()
        umbrales.confirmacion_segundos = 99
        umbrales.overlap_minimo = 0.3
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(
                self._video([frame]),
                MagicMock(detect=MagicMock(return_value=[])),
                cliente,
                [Zona(1, [(0, 0), (10, 0), (10, 10)])],
                confirmador,
                CAMARA["id"],
                umbrales=umbrales,
            )

        assert confirmador.segundos == 99

    def test_sin_umbrales_sigue_usando_el_env_como_antes(self, monkeypatch):
        # Compatibilidad: bucle() se puede seguir llamando sin umbrales (default None),
        # tal como lo hacen los tests preexistentes de TestBucle.
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = cliente_falso()
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(
                self._video([frame]),
                MagicMock(detect=MagicMock(return_value=[])),
                cliente,
                [Zona(1, [(0, 0), (10, 0), (10, 10)])],
                confirmador,
                CAMARA["id"],
            )

        assert confirmador.actualizar.call_args.args[0] == {1: False}


class TestBucleConZonasCache:
    def _video(self, frames):
        video = MagicMock()
        video.read_frame.side_effect = list(frames) + [KeyboardInterrupt]
        return video

    def test_el_bucle_refresca_las_zonas_en_cada_iteracion(self, monkeypatch):
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = cliente_falso()
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}
        zonas_cache = MagicMock()
        zonas_cache.zonas = [Zona(1, [(0, 0), (10, 0), (10, 10)])]
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(
                self._video([frame]),
                MagicMock(detect=MagicMock(return_value=[])),
                cliente,
                [Zona(1, [(0, 0), (10, 0), (10, 10)])],
                confirmador,
                CAMARA["id"],
                zonas_cache=zonas_cache,
            )

        # Igual que con umbrales: una vez por el frame real y otra en la iteración que
        # corta con KeyboardInterrupt, porque se refresca antes de leer el frame.
        assert zonas_cache.actualizar.call_count == 2

    def test_el_bucle_usa_las_zonas_del_cache_y_no_las_fijas_que_recibio(self, monkeypatch):
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = cliente_falso()
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}
        # La zona fija que recibe bucle() apunta a la mesa 1; el cache ya la refrescó y
        # ahora apunta a la mesa 2. Si el bucle usara la fija en vez de la del cache, la
        # ocupación resuelta sería sobre la mesa equivocada.
        zonas_cache = MagicMock()
        zonas_cache.zonas = [Zona(2, [(0, 0), (10, 0), (10, 10)])]
        deteccion = MagicMock(bbox=(0, 0, 10, 10))
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(
                self._video([frame]),
                MagicMock(detect=MagicMock(return_value=[deteccion])),
                cliente,
                [Zona(1, [(0, 0), (10, 0), (10, 10)])],
                confirmador,
                CAMARA["id"],
                zonas_cache=zonas_cache,
            )

        assert confirmador.actualizar.call_args.args[0] == {2: True}

    def test_sin_zonas_cache_sigue_usando_la_lista_fija_como_antes(self, monkeypatch):
        # Compatibilidad: bucle() se puede seguir llamando sin zonas_cache (default None),
        # tal como lo hacen los tests preexistentes de TestBucle.
        from app.mapping.zonas import Zona

        monkeypatch.setattr(config, "OVERLAP_MINIMO", 0.3)
        cliente = cliente_falso()
        confirmador = MagicMock()
        confirmador.actualizar.return_value = {}
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        with patch("app.main.time.sleep"), pytest.raises(KeyboardInterrupt):
            main.bucle(
                self._video([frame]),
                MagicMock(detect=MagicMock(return_value=[])),
                cliente,
                [Zona(1, [(0, 0), (10, 0), (10, 10)])],
                confirmador,
                CAMARA["id"],
            )

        assert confirmador.actualizar.call_args.args[0] == {1: False}


class TestMain:
    # Todo fallo de arranque tiene que salir por SystemExit con el mismo mensaje
    # entendible: el operador que levanta el módulo lee la última línea de la
    # consola, no un traceback (T26-135).
    @pytest.mark.parametrize(
        "fallo",
        [
            main.ConfiguracionInvalida("falta SECTOR_ID"),
            # ErrorBackend antes se escapaba: era el caso del backend caído.
            ErrorBackend("No se pudo contactar la API en http://localhost:8000"),
            CredencialesInvalidas("rol insuficiente"),
        ],
    )
    def test_un_fallo_de_arranque_sale_con_mensaje_limpio(self, fallo):
        with patch("app.main.run", side_effect=fallo):
            with pytest.raises(SystemExit) as salida:
                main.main()

        assert str(salida.value) == f"No se puede arrancar: {fallo}"

    def test_un_error_inesperado_sigue_propagando(self):
        # Solo se traducen los fallos previstos: un bug del módulo tiene que
        # dejar el traceback completo para poder diagnosticarlo.
        with patch("app.main.run", side_effect=RuntimeError("bug")):
            with pytest.raises(RuntimeError):
                main.main()


class TestAplicadorEnSegundoPlano:
    """Garantías del aplicador de cambios (T26-183).

    Es código concurrente: las garantías se prueban, no se afirman en un comentario.
    """

    def _cliente(self, estado="libre", demora=0.0):
        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = lambda mesa_id: (
            time.sleep(demora) or {"id": mesa_id, "numero": mesa_id, "estado": estado}
        )
        return cliente

    def _esperar_vacio(self, aplicador, timeout=5):
        limite = time.monotonic() + timeout
        while aplicador.pendientes() > 0 and time.monotonic() < limite:
            time.sleep(0.01)
        return aplicador.pendientes() == 0

    def test_aplica_el_cambio_encolado(self):
        cliente = self._cliente()
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=2)
        try:
            aplicador.encolar({221: True})
            assert self._esperar_vacio(aplicador)
        finally:
            aplicador.cerrar()

        cliente.cambiar_estado.assert_called_once_with(221, "ocupada")

    def test_encolar_no_bloquea_el_ciclo(self):
        """El punto del ticket: la etapa 'cambios' tiene que dejar de costar segundos."""
        cliente = self._cliente(demora=0.3)
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=4)
        try:
            inicio = time.monotonic()
            aplicador.encolar({1: True, 2: True, 3: True, 4: True})
            encolado = time.monotonic() - inicio
            # Cuatro mesas a 0.3s cada una serían 1.2s en serie. Encolar tiene que
            # ser inmediato; el margen es generoso para no depender del scheduler.
            assert encolado < 0.1, f"encolar tardó {encolado:.3f}s"
            assert self._esperar_vacio(aplicador)
        finally:
            aplicador.cerrar()

    def test_las_mesas_distintas_se_aplican_en_paralelo(self):
        cliente = self._cliente(demora=0.3)
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=4)
        try:
            inicio = time.monotonic()
            aplicador.encolar({1: True, 2: True, 3: True, 4: True})
            assert self._esperar_vacio(aplicador)
            total = time.monotonic() - inicio
        finally:
            aplicador.cerrar()

        # En serie serían ~1.2s; con 4 hilos, ~0.3s. Se afirma bien por debajo de
        # la mitad para que el test distinga paralelo de serie sin ser frágil.
        assert total < 0.7, f"las cuatro mesas tardaron {total:.3f}s, parece serie"

    def test_una_misma_mesa_se_aplica_en_orden_y_nunca_en_paralelo(self):
        """Entre mesas hay paralelismo; dentro de una mesa, orden estricto."""
        concurrentes = []
        en_curso = {"n": 0}
        candado = threading.Lock()

        def obtener(mesa_id):
            with candado:
                en_curso["n"] += 1
                concurrentes.append(en_curso["n"])
            time.sleep(0.05)
            with candado:
                en_curso["n"] -= 1
            return {"id": mesa_id, "numero": mesa_id, "estado": "libre"}

        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = obtener
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=4)
        try:
            for _ in range(6):
                aplicador.encolar({221: True})
            assert self._esperar_vacio(aplicador)
        finally:
            aplicador.cerrar()

        assert max(concurrentes) == 1, f"la misma mesa se procesó en paralelo: {concurrentes}"
        assert cliente.obtener_mesa.call_count == 6

    def test_un_fallo_se_reporta_para_que_el_ciclo_revierta(self):
        """No se pierde: el ciclo lo recoge y revierte la confirmación."""
        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = ErrorBackend("timeout")
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=1)
        try:
            aplicador.encolar({221: True})
            assert self._esperar_vacio(aplicador)
            fallidas = aplicador.recoger_fallidas()
        finally:
            aplicador.cerrar()

        assert fallidas == {221}

    def test_las_fallidas_se_entregan_una_sola_vez(self):
        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = ErrorBackend("timeout")
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=1)
        try:
            aplicador.encolar({221: True})
            assert self._esperar_vacio(aplicador)
            assert aplicador.recoger_fallidas() == {221}
            # Segunda lectura vacía: si no, el ciclo revertiría dos veces la misma mesa.
            assert aplicador.recoger_fallidas() == set()
        finally:
            aplicador.cerrar()

    def test_un_403_se_relanza_en_el_hilo_del_ciclo(self):
        """Antes de T26-183 un permiso insuficiente cortaba el proceso. Tiene que seguir
        cortándolo aunque el trabajo se haya movido a un worker."""
        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = CredencialesInvalidas("rol insuficiente")
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=1)
        try:
            aplicador.encolar({221: True})
            assert self._esperar_vacio(aplicador)
            with pytest.raises(CredencialesInvalidas):
                aplicador.revisar_fatal()
        finally:
            aplicador.cerrar()

    def test_desbordar_la_cola_de_una_mesa_no_pierde_el_cambio_en_silencio(self):
        cliente = self._cliente(demora=0.4)
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=1, maximo_por_mesa=2)
        try:
            for _ in range(6):
                aplicador.encolar({221: True})
            fallidas = aplicador.recoger_fallidas()
        finally:
            aplicador.cerrar()

        # Lo que no entró se reporta como fallo para que el ciclo lo reintente, en
        # vez de acumularse sin techo o desaparecer.
        assert fallidas == {221}

    def test_un_error_inesperado_no_mata_al_worker(self):
        """Si un worker muere, su mesa queda colgada para siempre."""
        cliente = MagicMock()
        cliente.obtener_mesa.side_effect = [RuntimeError("bug"), {"id": 9, "numero": 9, "estado": "libre"}]
        aplicador = main.AplicadorEnSegundoPlano(cliente, hilos=1)
        try:
            aplicador.encolar({221: True})
            assert self._esperar_vacio(aplicador)
            aplicador.encolar({9: True})
            assert self._esperar_vacio(aplicador)
        finally:
            aplicador.cerrar()

        cliente.cambiar_estado.assert_called_once_with(9, "ocupada")
