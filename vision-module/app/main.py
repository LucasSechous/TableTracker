# Punto de entrada del módulo de visión.
# Orquesta el pipeline: captura de frames -> detección YOLO -> overlap contra los
# ROI de la cámara -> confirmación por tiempo sostenido -> cambio de estado en la
# API de TableTracker (RF-10, RF-11).
#
# La configuración del sector piloto vive en el backend, no acá: qué cámara mirar
# y qué polígono corresponde a cada mesa se leen al arrancar de `/camaras` y
# `/roi-mesa`. El .env solo dice cuál es el sector piloto y aporta los secretos
# que la API no entrega (la contraseña del stream RTSP).

import time
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


def publicar_deteccion_actual(cliente, camara_id, detector, detecciones, frame):
    """Publica el resultado crudo del frame para la vista en vivo (T26-150).

    A diferencia de aplicar_cambio(), esto es información secundaria: no debe
    poder frenar ni tumbar el loop de confirmación/cambio de estado bajo ningún
    motivo. Por eso el catch es amplio (no solo ErrorBackend) — también cubre un
    payload que no valida (ej. un bbox degenerado) — y lo único que hace ante
    cualquier falla es loguear y seguir con el próximo frame.
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
            return
        cliente.cambiar_estado(mesa_id, objetivo)
        logger.info("Mesa nº %s: %s → %s", mesa["numero"], mesa["estado"], objetivo)
    except CredencialesInvalidas:
        # Rol insuficiente o usuario inválido: reintentar no lo arregla.
        raise
    except ErrorBackend as error:
        # Se olvida la confirmación para que el próximo frame la vuelva a
        # confirmar y reintente; si no, la mesa quedaría desincronizada hasta
        # que la ocupación cambiara de nuevo.
        confirmador.revertir(mesa_id)
        logger.error("No se pudo actualizar la mesa %s, se reintenta: %s", mesa_id, error)


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


def bucle(video, detector, cliente, zonas, confirmador, camara_id):
    fallidos = 0
    primer_frame = True
    while True:
        inicio = time.monotonic()
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

        detecciones = detector.detect(frame)
        publicar_deteccion_actual(cliente, camara_id, detector, detecciones, frame)
        ocupacion = zonas_mod.resolver_ocupacion(zonas, detecciones, config.OVERLAP_MINIMO)
        for mesa_id, hay_gente in confirmador.actualizar(ocupacion, inicio).items():
            aplicar_cambio(cliente, confirmador, mesa_id, hay_gente)

        esperar_proximo_frame(inicio)


def esperar_proximo_frame(inicio):
    # Se descuenta lo que tardó el frame para que la cadencia sea la configurada
    # y no "el intervalo más la inferencia", que iría corriéndose.
    restante = config.FRAME_INTERVAL_SECONDS - (time.monotonic() - inicio)
    if restante > 0:
        time.sleep(restante)


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

    detector = Detector(config.YOLO_MODEL_PATH, config.YOLO_CONFIDENCE, config.YOLO_CLASSES)
    detector.load()

    video = Camera(fuente)
    video.open()
    logger.info(
        "Procesando %s cada %ss — overlap mínimo %.2f, confirmación a los %ss",
        rtsp_url.enmascarar(fuente),
        config.FRAME_INTERVAL_SECONDS,
        config.OVERLAP_MINIMO,
        config.CONFIRMACION_SEGUNDOS,
    )

    try:
        bucle(video, detector, cliente, zonas, Confirmador(config.CONFIRMACION_SEGUNDOS), camara["id"])
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
