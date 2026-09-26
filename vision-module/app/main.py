# Punto de entrada del módulo de visión.
# Orquesta el pipeline: captura de frames -> detección YOLO -> overlap contra los
# ROI de la cámara -> confirmación por tiempo sostenido -> cambio de estado en la
# API de TableTracker (RF-10, RF-11).
#
# La configuración del sector piloto vive en el backend, no acá: qué cámara mirar
# y qué polígono corresponde a cada mesa se leen al arrancar de `/camaras` y
# `/roi-mesa`. El .env solo dice cuál es el sector piloto y aporta los secretos
# que la API no entrega (la contraseña del stream RTSP).

import threading
import time
from collections import deque
from datetime import datetime, timezone

from app import config
from app.capture.camera import Camera
from app.client.backend_client import BackendClient, CredencialesInvalidas, ErrorBackend
from app.detection.detector import Detector
from app.mapping import politica, zonas as zonas_mod
from app.mapping.confirmacion import Confirmador
from app.utils import rtsp_url
from app.utils.logger import get_logger
from schemas.detection_output import Detection, DetectionBox, DetectionFrameResult

logger = get_logger(__name__)


class ConfiguracionInvalida(Exception):
    # Falta un dato del .env o el sector piloto no está bien armado en el
    # backend. Corta el arranque: el pipeline no tiene sobre qué trabajar.
    pass


def validar_configuracion():
    faltantes = [
        nombre
        for nombre in ("BACKEND_EMAIL", "BACKEND_PASSWORD", "SECTOR_ID")
        if getattr(config, nombre) is None
    ]
    if faltantes:
        raise ConfiguracionInvalida(
            f"Faltan variables en vision-module/.env: {', '.join(faltantes)} (ver .env.example)"
        )
    if not 0 < config.OVERLAP_MINIMO <= 1:
        raise ConfiguracionInvalida(
            f"OVERLAP_MINIMO tiene que estar entre 0 y 1, es una fracción del bounding box "
            f"(está en {config.OVERLAP_MINIMO})"
        )


def seleccionar_camara(cliente, sector_id, camara_id):
    """La cámara del sector piloto que va a procesar esta instancia.

    Con una sola cámara activa en el sector alcanza con SECTOR_ID. Si hay varias
    no se elige una por omisión —sería procesar en silencio una parte del sector
    y no la que el operador cree— y se exige CAMARA_ID.
    """
    camaras = cliente.listar_camaras(sector_id=sector_id)
    if not camaras:
        raise ConfiguracionInvalida(
            f"El sector {sector_id} no tiene cámaras activas: registrá una en /camaras antes de arrancar"
        )

    if camara_id is None:
        if len(camaras) > 1:
            disponibles = ", ".join(f"{c['id']} ({c['nombre']})" for c in camaras)
            raise ConfiguracionInvalida(
                f"El sector {sector_id} tiene {len(camaras)} cámaras activas: {disponibles}. "
                "Indicá cuál procesar con CAMARA_ID en el .env."
            )
        return camaras[0]

    elegida = next((c for c in camaras if c["id"] == camara_id), None)
    if elegida is None:
        disponibles = ", ".join(str(c["id"]) for c in camaras) or "ninguna"
        raise ConfiguracionInvalida(
            f"La cámara {camara_id} no está activa en el sector {sector_id} (activas: {disponibles})"
        )
    return elegida


def cargar_zonas(cliente, camara, sector_id):
    """Los ROI activos de la cámara, ya validados contra las mesas del sector."""
    rois = cliente.listar_rois(camara["id"])
    if not rois:
        raise ConfiguracionInvalida(
            f"La cámara {camara['id']} ({camara['nombre']}) no tiene ROI activos: "
            "dibujá al menos uno en /roi-mesa antes de arrancar"
        )

    # Un ROI puede quedar apuntando a una mesa dada de baja o movida de sector:
    # el backend no valida eso al desactivar la mesa. Se descartan acá, con el
    # motivo en el log, en vez de mandar cambios de estado a una mesa fantasma.
    mesas = {mesa["id"]: mesa for mesa in cliente.listar_mesas(sector_id=sector_id)}
    vigentes = []
    for roi in rois:
        if roi["mesa_id"] not in mesas:
            logger.warning(
                "ROI %s ignorado: la mesa %s no está activa en el sector %s",
                roi["id"],
                roi["mesa_id"],
                sector_id,
            )
            continue
        vigentes.append(roi)

    if not vigentes:
        raise ConfiguracionInvalida(
            f"Ninguno de los {len(rois)} ROI de la cámara {camara['id']} apunta a una mesa "
            f"activa del sector {sector_id}"
        )

    zonas = zonas_mod.desde_rois(vigentes)
    for zona in zonas:
        logger.info(
            "ROI %s → mesa %s (nº %s), %d puntos",
            zona.roi_id,
            zona.mesa_id,
            mesas[zona.mesa_id]["numero"],
            len(zona.poligono),
        )
    return zonas


def resolver_fuente(camara):
    """De dónde sale el video: la cámara del backend, salvo override de desarrollo."""
    if config.VIDEO_SOURCE is not None:
        logger.warning(
            "VIDEO_SOURCE está definido (%s): se usa esa fuente y NO el stream de la cámara %s. "
            "Dejalo vacío para procesar la cámara registrada en el backend.",
            config.VIDEO_SOURCE,
            camara["id"],
        )
        return config.VIDEO_SOURCE

    url = camara["rtsp_url"]
    if not rtsp_url.tiene_password_enmascarada(url):
        return url

    # La API tapa la contraseña por diseño (docs/camaras-roi.md), así que la URL
    # que llega no sirve para conectarse hasta completarla desde el .env.
    if not config.CAMARA_PASSWORD:
        raise ConfiguracionInvalida(
            f"La cámara {camara['id']} ({camara['nombre']}) tiene credenciales y la API no "
            "devuelve la contraseña: cargá CAMARA_PASSWORD en vision-module/.env"
        )
    return rtsp_url.con_password(url, config.CAMARA_PASSWORD)


def avisar_zonas_fuera_del_frame(zonas, frame):
    # El backend valida que las coordenadas no sean negativas pero no conoce la
    # resolución de la cámara (docs/camaras-roi.md): el control del límite
    # superior queda de este lado. No es fatal —el recorte contra el bbox ignora
    # lo que sobra— pero casi siempre significa que el ROI se dibujó sobre un
    # frame de otra resolución y está corrido.
    alto, ancho = frame.shape[:2]
    for zona in zonas:
        excedidos = zona.fuera_del_frame(ancho, alto)
        if excedidos:
            logger.warning(
                "ROI %s (mesa %s) tiene %d punto(s) fuera del frame de %dx%d, ej. %s: "
                "¿se dibujó sobre otra resolución?",
                zona.roi_id,
                zona.mesa_id,
                len(excedidos),
                ancho,
                alto,
                excedidos[0],
            )


class CacheUmbrales:
    """Mantiene CONFIRMACION_SEGUNDOS y OVERLAP_MINIMO al día contra GET /configuracion.

    T26-183: esos dos parámetros dejaron de vivir en el .env para poder calibrarlos desde
    la pantalla de configuración sin reiniciar el módulo. Guardar el último valor conocido
    y refrescarlo cada CONFIGURACION_REFRESCO_ITERACIONES iteraciones —no en cada una— es
    el punto medio del ticket: evita una llamada HTTP por frame por un dato que rara vez
    cambia, sin obligar a reiniciar el proceso para que un ajuste tenga efecto.

    Si la API no responde se mantiene el último valor bueno y se loguea en WARNING: un
    backend caído en medio del loop no puede tumbar la detección, mismo criterio que
    aplicar_cambio() ya usa para los cambios de estado.
    """

    def __init__(self, cliente, confirmacion_segundos, overlap_minimo, cada_iteraciones):
        self.cliente = cliente
        self.confirmacion_segundos = confirmacion_segundos
        self.overlap_minimo = overlap_minimo
        self.cada_iteraciones = cada_iteraciones
        self._iteracion = 0

    def actualizar(self):
        """Se llama una vez por iteración del bucle; solo pega contra la API cada N."""
        self._iteracion += 1
        if self._iteracion % self.cada_iteraciones != 0:
            return
        try:
            config_remota = self.cliente.obtener_configuracion()
        except ErrorBackend as error:
            logger.warning("No se pudo refrescar la configuración, se sigue con la última conocida: %s", error)
            return

        nuevo_confirmacion = config_remota["confirmacion_segundos"]
        nuevo_overlap = config_remota["overlap_minimo"]
        if nuevo_confirmacion != self.confirmacion_segundos:
            logger.warning(
                "CONFIRMACION_SEGUNDOS cambió de %s a %s: la detección en curso se ve afectada",
                self.confirmacion_segundos,
                nuevo_confirmacion,
            )
            self.confirmacion_segundos = nuevo_confirmacion
        if nuevo_overlap != self.overlap_minimo:
            logger.warning(
                "OVERLAP_MINIMO cambió de %s a %s: la detección en curso se ve afectada",
                self.overlap_minimo,
                nuevo_overlap,
            )
            self.overlap_minimo = nuevo_overlap


class PublicadorEnSegundoPlano:
    """Manda la detección actual al backend sin bloquear el ciclo.

    Medido con la instrumentación de T26-181: ese POST tardaba una mediana de 672 ms,
    tanto como la inferencia de YOLO, y se lo comía del presupuesto de 2 s del ciclo
    aunque sea información secundaria. El backend persiste contra una base remota, así
    que el costo es una ida y vuelta de red, no CPU.

    Se descarta el envío si el anterior sigue en curso, en vez de encolarlo: publicar
    una foto vieja no sirve para una vista "en vivo", y una cola sin límite terminaría
    creciendo si el backend se pone lento. Un solo hilo a la vez, y el que no llega se
    pierde a propósito.
    """

    def __init__(self):
        self._hilo = None

    def publicar(self, cliente, camara_id, detector, detecciones, frame):
        if self._hilo is not None and self._hilo.is_alive():
            logger.debug("El envío anterior de la detección actual sigue en curso: se saltea este frame")
            return
        self._hilo = threading.Thread(
            target=publicar_deteccion_actual,
            args=(cliente, camara_id, detector, detecciones, frame),
            daemon=True,
        )
        self._hilo.start()


def publicar_deteccion_actual(cliente, camara_id, detector, detecciones, frame):
    """Publica el resultado crudo del frame para la vista en vivo (T26-150).

    A diferencia de aplicar_cambio(), esto es información secundaria: no debe
    poder frenar ni tumbar el loop de confirmación/cambio de estado bajo ningún
    motivo. Por eso el catch es amplio (no solo ErrorBackend) — también cubre un
    payload que no valida (ej. un bbox degenerado) — y lo único que hace ante
    cualquier falla es loguear y seguir con el próximo frame.

    Corre en un hilo aparte (ver PublicadorEnSegundoPlano); se deja como función
    suelta para poder llamarla sincrónicamente desde los tests.
    """
    try:
        alto, ancho = frame.shape[:2]
        payload = DetectionFrameResult(
            frame_timestamp=datetime.now(timezone.utc),
            source_id=str(camara_id),
            frame_width=ancho,
            frame_height=alto,
            model_name=config.YOLO_MODEL_PATH.stem,
            detections=[
                Detection(
                    class_id=deteccion.clase,
                    # Mismo patrón que scripts/test_condiciones.py:_nombre_clase —
                    # el mapeo sale del propio modelo cargado, no de una tabla
                    # COCO hardcodeada que podría desincronizarse de los pesos.
                    class_name=detector.model.names.get(deteccion.clase, str(deteccion.clase)),
                    confidence=deteccion.confianza,
                    bbox=DetectionBox(
                        x1=int(deteccion.bbox[0]),
                        y1=int(deteccion.bbox[1]),
                        x2=int(deteccion.bbox[2]),
                        y2=int(deteccion.bbox[3]),
                    ),
                )
                for deteccion in detecciones
            ],
        )
        cliente.publicar_deteccion_actual(camara_id, payload.model_dump(mode="json"))
    except Exception as error:
        logger.warning(
            "No se pudo publicar la detección actual de la cámara %s, se sigue igual: %s", camara_id, error
        )


def aplicar_cambio(cliente, confirmador, mesa_id, hay_gente):
    """Lleva al backend un cambio ya confirmado, si la política lo permite.

    El estado actual se relee justo antes: entre dos cambios de una misma mesa
    pasan segundos en los que un mozo o recepción pudieron tocarla, y la
    política se decide sobre el estado real, no sobre uno cacheado.

    Desde T26-183 esto NO corre en el hilo del ciclo sino en un worker de
    AplicadorEnSegundoPlano. `confirmador` se sigue aceptando para no romper a
    quien la llame directo, pero el aplicador pasa None y recoge los fallos por
    su cuenta: Confirmador no es thread-safe (ver la clase para el detalle).
    """
    try:
        mesa = cliente.obtener_mesa(mesa_id)
        objetivo = politica.estado_objetivo(hay_gente, mesa["estado"])
        if objetivo is None:
            logger.info(
                "Mesa nº %s: %s pero está en «%s», se deja como está",
                mesa["numero"],
                "hay gente" if hay_gente else "vacía",
                mesa["estado"],
            )
            # No-op deliberado, no un fallo: no hay nada que reintentar.
            return True
        cliente.cambiar_estado(mesa_id, objetivo)
        logger.info("Mesa nº %s: %s → %s", mesa["numero"], mesa["estado"], objetivo)
    except CredencialesInvalidas:
        # Rol insuficiente o usuario inválido: reintentar no lo arregla.
        raise
    except ErrorBackend as error:
        # Se olvida la confirmación para que el próximo frame la vuelva a
        # confirmar y reintente; si no, la mesa quedaría desincronizada hasta
        # que la ocupación cambiara de nuevo.
        if confirmador is not None:
            confirmador.revertir(mesa_id)
        logger.error("No se pudo actualizar la mesa %s, se reintenta: %s", mesa_id, error)
        return False
    return True


class AplicadorEnSegundoPlano:
    """Aplica los cambios de estado fuera del hilo del ciclo, sin perder ninguno (T26-183).

    El problema medido: aplicar_cambio() hace dos llamadas sincrónicas al backend
    (GET del estado real + PATCH) y cuesta ~1.3s por mesa contra la base remota. En
    el ciclo eso se acumula —tres mesas juntas dieron 4.4s contra un presupuesto de
    2s— y cuando se pasa, esperar_proximo_frame() deja de dormir: la detección
    entera se degrada justo en la ráfaga de apertura del servicio, que es cuando
    más importa.

    Por qué NO se copia PublicadorEnSegundoPlano: aquel descarta el envío si el
    anterior sigue en curso, y está bien, porque publicar una foto vieja para una
    vista en vivo no sirve. Un cambio de estado es lo contrario: es el producto del
    sistema, no se puede perder ni aplicar fuera de orden.

    Garantías:

    * Nada se descarta. Un cambio que no se pudo aplicar vuelve como fallo y el
      ciclo revierte su confirmación para que el próximo frame lo reintente.
    * Orden por mesa. Cada mesa tiene su propia cola FIFO y nunca la procesan dos
      workers a la vez, así que sus cambios se aplican en el orden en que se
      confirmaron. Entre mesas distintas no hay orden que preservar: son
      independientes, y ahí está el paralelismo que corta el tiempo de la ráfaga.
    * Acotado. Cada cola tiene tope; si se desborda, el cambio se reporta como
      fallo en vez de crecer sin límite.

    Los fallos NO se revierten desde el worker: Confirmador muta dos diccionarios
    sin candado y está pensado para un solo hilo. El worker los deja anotados y el
    ciclo los recoge con `recoger_fallidas()`, así toda la mutación del confirmador
    sigue ocurriendo en el mismo hilo de siempre.
    """

    def __init__(self, cliente, hilos=None, maximo_por_mesa=None):
        self._cliente = cliente
        self._hilos = hilos if hilos is not None else config.APLICADOR_HILOS
        self._maximo_por_mesa = (
            maximo_por_mesa if maximo_por_mesa is not None else config.APLICADOR_MAXIMO_POR_MESA
        )
        # mesa_id -> deque de valores confirmados pendientes de aplicar, en orden.
        self._colas = {}
        # Mesas con trabajo pendiente que ningún worker tomó todavía. Que una mesa
        # esté acá o en manos de un worker (y en ningún caso en los dos lugares) es
        # lo que garantiza que no se procese dos veces en paralelo.
        self._listas = deque()
        self._fallidas = set()
        # Un problema de permisos no se arregla reintentando, y antes de T26-183
        # cortaba el proceso porque aplicar_cambio corría en el hilo principal.
        # Desde un worker, relanzar solo mataría ese hilo: se guarda acá y el ciclo
        # la vuelve a levantar, conservando el comportamiento de siempre.
        self._fatal = None
        self._condicion = threading.Condition()
        self._cerrando = False
        self._workers = [
            threading.Thread(target=self._trabajar, name=f"aplicador-{i}", daemon=True)
            for i in range(self._hilos)
        ]
        for worker in self._workers:
            worker.start()

    def encolar(self, cambios):
        """Registra los cambios confirmados de un frame. No bloquea."""
        if not cambios:
            return
        with self._condicion:
            for mesa_id, hay_gente in cambios.items():
                cola = self._colas.setdefault(mesa_id, deque())
                if len(cola) >= self._maximo_por_mesa:
                    # El backend viene tan lento que la mesa acumuló más cambios de
                    # los que tiene sentido guardar. Se reporta como fallo para que
                    # el ciclo revierta y reintente, en vez de crecer sin techo.
                    logger.warning(
                        "La mesa %s acumuló %d cambios sin aplicar: se descarta el último y se reintentará",
                        mesa_id,
                        len(cola),
                    )
                    self._fallidas.add(mesa_id)
                    continue
                cola.append(hay_gente)
                if len(cola) == 1 and mesa_id not in self._listas:
                    self._listas.append(mesa_id)
            self._condicion.notify_all()

    def recoger_fallidas(self):
        """Mesas cuyo cambio no se pudo aplicar. Las devuelve una sola vez."""
        with self._condicion:
            fallidas, self._fallidas = self._fallidas, set()
        return fallidas

    def revisar_fatal(self):
        """Relanza en el hilo del ciclo un error que no tiene sentido reintentar."""
        with self._condicion:
            fatal = self._fatal
        if fatal is not None:
            raise fatal

    def pendientes(self):
        with self._condicion:
            return sum(len(cola) for cola in self._colas.values())

    def _trabajar(self):
        while True:
            with self._condicion:
                while not self._listas and not self._cerrando:
                    self._condicion.wait()
                if self._cerrando and not self._listas:
                    return
                mesa_id = self._listas.popleft()
                # Se lee sin sacar: si el cambio falla igual hay que quitarlo (lo
                # reintenta el ciclo vía revertir), pero mientras se aplica la mesa
                # no puede volver a _listas y por eso nadie más la toma.
                hay_gente = self._colas[mesa_id][0]

            try:
                aplicado = aplicar_cambio(self._cliente, None, mesa_id, hay_gente)
            except CredencialesInvalidas as error:
                # Reintentar un 403 no lo arregla. Se guarda para que el ciclo corte
                # el proceso, igual que hacía antes de mover esto a segundo plano.
                with self._condicion:
                    self._fatal = error
                aplicado = False
            except Exception as error:
                # Un worker que muere deja su mesa colgada para siempre. Cualquier
                # error inesperado se trata como fallo reintentable.
                logger.exception("Error inesperado aplicando la mesa %s: %s", mesa_id, error)
                aplicado = False

            with self._condicion:
                self._colas[mesa_id].popleft()
                if not aplicado:
                    self._fallidas.add(mesa_id)
                if self._colas[mesa_id]:
                    self._listas.append(mesa_id)
                else:
                    del self._colas[mesa_id]
                self._condicion.notify_all()

    def cerrar(self, timeout=5):
        """Corta los workers. Lo pendiente que no llegue a aplicarse se pierde a propósito:
        al apagar el módulo, un cambio viejo escrito tarde es peor que no escribirlo."""
        with self._condicion:
            self._cerrando = True
            self._condicion.notify_all()
        for worker in self._workers:
            worker.join(timeout=timeout)


def reconectar(video):
    logger.warning("Reabriendo la fuente de video")
    video.release()
    while True:
        try:
            video.open()
            logger.info("Fuente de video restablecida")
            return
        except RuntimeError as error:
            logger.error("No se pudo reabrir la fuente (%s), reintento en %ss", error, config.RECONEXION_SEGUNDOS)
            time.sleep(config.RECONEXION_SEGUNDOS)


def bucle(
    video, detector, cliente, zonas, confirmador, camara_id, publicador=None, aplicador=None, umbrales=None
):
    publicador = publicador if publicador is not None else PublicadorEnSegundoPlano()
    # Si lo creamos nosotros, también lo cerramos: al salir por Ctrl+C conviene darle
    # unos segundos a los cambios en vuelo en vez de que los workers mueran de golpe
    # con el intérprete. Un aplicador inyectado (los tests) lo cierra quien lo pasó.
    aplicador_propio = aplicador is None
    aplicador = aplicador if aplicador is not None else AplicadorEnSegundoPlano(cliente)
    try:
        _ciclar(video, detector, cliente, zonas, confirmador, camara_id, publicador, aplicador, umbrales)
    finally:
        if aplicador_propio:
            aplicador.cerrar()


# umbrales por defecto en None y no obligatorio: sin caché de umbrales el ciclo cae al .env,
# que es como funcionaba antes de T26-183. Los tests preexistentes de TestBucle llaman a
# bucle() sin pasarlo, y tienen que seguir andando.
def _ciclar(video, detector, cliente, zonas, confirmador, camara_id, publicador, aplicador, umbrales=None):
    fallidos = 0
    primer_frame = True
    while True:
        inicio = time.monotonic()

        # Umbrales de detección (T26-183): se refrescan antes de procesar el frame para
        # que, si cambiaron, el resto del ciclo ya trabaje con el valor nuevo.
        if umbrales is not None:
            umbrales.actualizar()
            confirmador.segundos = umbrales.confirmacion_segundos

        frame = video.read_frame()

        if frame is None:
            # Un frame perdido no es una mesa vacía: sin imagen no se observa
            # nada y el reloj de confirmación se deja como está.
            fallidos += 1
            logger.warning("Frame vacío (%d de %d tolerados)", fallidos, config.FRAMES_FALLIDOS_MAXIMOS)
            if fallidos >= config.FRAMES_FALLIDOS_MAXIMOS:
                reconectar(video)
                fallidos = 0
            esperar_proximo_frame(inicio)
            continue

        fallidos = 0
        if primer_frame:
            avisar_zonas_fuera_del_frame(zonas, frame)
            primer_frame = False

        # Se cronometra cada etapa por separado (T26-181). Sin esto, un ciclo lento se
        # ve igual desde afuera venga de YOLO, del backend o de la cámara, y no hay
        # forma de elegir el modelo o la resolución con criterio: se estaría tuneando
        # a ciegas.
        etapas = {}
        t = time.monotonic()
        detecciones = detector.detect(frame)
        etapas["inferencia"] = time.monotonic() - t

        t = time.monotonic()
        publicador.publicar(cliente, camara_id, detector, detecciones, frame)
        etapas["publicar"] = time.monotonic() - t

        overlap_minimo = umbrales.overlap_minimo if umbrales is not None else config.OVERLAP_MINIMO
        t = time.monotonic()
        ocupacion = zonas_mod.resolver_ocupacion(zonas, detecciones, overlap_minimo, config.ANCLAJE_OVERLAP)
        etapas["ocupacion"] = time.monotonic() - t

        t = time.monotonic()
        # Encolar y seguir: el trabajo caro (dos idas y vueltas al backend por mesa)
        # lo hacen los workers del aplicador. Esta etapa pasa a costar microsegundos,
        # que es justamente lo que T26-183 vino a arreglar.
        aplicador.encolar(confirmador.actualizar(ocupacion, inicio))
        # Los cambios que no se pudieron aplicar se revierten ACÁ y no en el worker:
        # Confirmador no es thread-safe y toda su mutación tiene que quedar en este hilo.
        for mesa_id in aplicador.recoger_fallidas():
            confirmador.revertir(mesa_id)
        # Un 403 no se reintenta: se levanta en este hilo y corta el proceso, igual
        # que cuando aplicar_cambio corría en línea.
        aplicador.revisar_fatal()
        etapas["cambios"] = time.monotonic() - t

        registrar_presupuesto(inicio, etapas)
        esperar_proximo_frame(inicio)


def registrar_presupuesto(inicio, etapas):
    """Deja constancia de cuánto tardó el ciclo y en qué se fue el tiempo.

    El detalle va en DEBUG para no ensuciar la operación normal, pero pasarse del
    presupuesto sale como WARNING: cuando el ciclo tarda más que
    FRAME_INTERVAL_SECONDS, esperar_proximo_frame() no duerme nada y la cadencia se
    degrada EN SILENCIO —el bucle pasa a correr todo lo rápido que puede y el CPU se
    clava—. Sin este aviso, desde afuera se ve igual que «la detección va lenta».
    """
    total = time.monotonic() - inicio
    detalle = ", ".join(f"{nombre} {segundos * 1000:.0f}ms" for nombre, segundos in etapas.items())

    if total > config.FRAME_INTERVAL_SECONDS:
        logger.warning(
            "El ciclo tardó %.2fs y el presupuesto es %.2fs (se pasó %.2fs): %s",
            total,
            config.FRAME_INTERVAL_SECONDS,
            total - config.FRAME_INTERVAL_SECONDS,
            detalle,
        )
    else:
        logger.debug("Ciclo %.0fms de %.0fms disponibles: %s", total * 1000, config.FRAME_INTERVAL_SECONDS * 1000, detalle)


def esperar_proximo_frame(inicio):
    # Se descuenta lo que tardó el frame para que la cadencia sea la configurada
    # y no "el intervalo más la inferencia", que iría corriéndose.
    restante = config.FRAME_INTERVAL_SECONDS - (time.monotonic() - inicio)
    if restante > 0:
        time.sleep(restante)


def cargar_umbrales_iniciales(cliente):
    """CacheUmbrales arrancado con lo que diga la API, o el default del .env si no responde.

    Un backend caído justo al arrancar no tiene por qué impedir que el módulo procese: ya
    es el criterio de aplicar_cambio() y CacheUmbrales.actualizar() durante el loop, así que
    el arranque no debería ser más estricto.
    """
    try:
        config_remota = cliente.obtener_configuracion()
        confirmacion_segundos = config_remota["confirmacion_segundos"]
        overlap_minimo = config_remota["overlap_minimo"]
    except ErrorBackend as error:
        logger.warning(
            "No se pudo leer /configuracion al arrancar, se usan los valores del .env: %s", error
        )
        confirmacion_segundos = config.CONFIRMACION_SEGUNDOS
        overlap_minimo = config.OVERLAP_MINIMO
    return CacheUmbrales(cliente, confirmacion_segundos, overlap_minimo, config.CONFIGURACION_REFRESCO_ITERACIONES)


def run():
    logger.info("Módulo de visión iniciado — sector piloto %s", config.SECTOR_ID)
    validar_configuracion()

    cliente = BackendClient(
        config.BACKEND_URL, config.BACKEND_EMAIL, config.BACKEND_PASSWORD, timeout=config.BACKEND_TIMEOUT
    )
    cliente.login()

    camara = seleccionar_camara(cliente, config.SECTOR_ID, config.CAMARA_ID)
    logger.info("Cámara %s (%s): %s", camara["id"], camara["nombre"], camara["rtsp_url"])
    zonas = cargar_zonas(cliente, camara, config.SECTOR_ID)
    fuente = resolver_fuente(camara)
    umbrales = cargar_umbrales_iniciales(cliente)

    detector = Detector(
        config.YOLO_MODEL_PATH, config.YOLO_CONFIDENCE, config.YOLO_CLASSES, imgsz=config.YOLO_IMGSZ
    )
    detector.load()

    video = Camera(fuente, antiguedad_maxima=config.FRAME_ANTIGUEDAD_MAXIMA_SEGUNDOS)
    video.open()
    logger.info(
        "Procesando %s cada %ss — overlap mínimo %.2f, confirmación a los %ss",
        rtsp_url.enmascarar(fuente),
        config.FRAME_INTERVAL_SECONDS,
        umbrales.overlap_minimo,
        umbrales.confirmacion_segundos,
    )

    try:
        bucle(
            video,
            detector,
            cliente,
            zonas,
            Confirmador(umbrales.confirmacion_segundos),
            camara["id"],
            umbrales=umbrales,
        )
    except KeyboardInterrupt:
        logger.info("Módulo de visión detenido")
    finally:
        video.release()


def main():
    """Arranque desde la línea de comandos: traduce los fallos a un mensaje limpio."""
    try:
        run()
    except (ConfiguracionInvalida, ErrorBackend) as error:
        # ErrorBackend cubre también a CredencialesInvalidas, que hereda de ella:
        # cualquier fallo de arranque contra la API —backend caído, 5xx, timeout,
        # credenciales o rol— sale con el mismo mensaje entendible y no con el
        # traceback crudo (T26-135). Un backend que se cae *durante* el loop no
        # llega acá: lo maneja aplicar_cambio() reintentando.
        raise SystemExit(f"No se puede arrancar: {error}")


if __name__ == "__main__":
    main()
