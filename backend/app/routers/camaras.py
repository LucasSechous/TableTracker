import cv2
import time
from contextlib import contextmanager
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import es_violacion_unique, get_db
from app.routers._comun import validar_sector
from app.models.camara import Camara
from app.models.sector import Sector
from app.schemas.camara import CamaraCreate, CamaraUpdate, CamaraResponse, CamaraTestResponse, CamaraTestUrlRequest
from app.schemas.deteccion import DetectionFrameResult
from app.routers.auth import get_usuario_actual, requiere_rol, ROL_ADMIN, ROL_VISION_MODULE
from app.services import cifrado, rtsp

# El propio OpenCV (no solo ffmpeg) escribe warnings de conexión a stderr por su
# cuenta; nunca incluyen la URL completa (solo host/hostname), pero de todos
# modos conviene no dejar pasar el ruido de cada cámara caída como si fuera un
# problema del backend.
cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)

# Configuración de cámaras: admin en todos los verbos (T26-116, docs/roles-permisos.md).
# El listado también queda restringido porque la respuesta expone la topología de red
# del local — host, puerto y usuario de cada cámara — y eso no es información para
# cualquier rol autenticado.
#
# El permiso va por endpoint y no en el APIRouter (T26-164, patrón de mesas.py). Con
# la dependencia a nivel de router, sumar vision_module para los dos endpoints que el
# módulo necesita se lo daba también a POST, PATCH y DELETE: el usuario técnico podía
# dar de alta y borrar cámaras. Acá el router solo exige estar autenticado y cada
# operación declara su rol.
#
# OJO al agregar un endpoint nuevo: sin `dependencies=` queda abierto a cualquier
# usuario autenticado. Todos los de este archivo llevan uno; que no sea el tuyo el
# primero que falte.
router = APIRouter(dependencies=[Depends(get_usuario_actual)])

# ROL_ADMIN queda explícito aunque requiere_rol() ya lo deje pasar siempre: no
# depender de ese comportamiento en silencio.
SOLO_ADMIN = [Depends(requiere_rol(ROL_ADMIN))]

# Lo único que vision-module consume de este router (T26-152, T26-164): el listado
# para descubrir las cámaras del sector al arrancar, y el POST con el resultado de
# cada frame. Ver vision-module/app/client/backend_client.py.
ADMIN_O_VISION = [Depends(requiere_rol(ROL_ADMIN, ROL_VISION_MODULE))]

# Última detección conocida por cámara (T26-150, vista en vivo): dict en memoria
# del proceso, no en disco ni en Supabase — ver docs/privacidad-vision.md §3
# (ahí está documentada la excepción: qué se guarda, dónde, cuándo se activa y
# cómo se descarta). Solo el último valor, sin historial; se pierde al reiniciar
# el proceso. Asume backend single-worker (docs/vision-loop.md): con más de uno
# cada proceso tendría su propio dict y el GET podría devolver un valor viejo
# según a cuál le llegó el último POST. Un dict simple alcanza sin lock porque
# CPython solo tiene un hilo corriendo bytecode a la vez y __setitem__/get sobre
# una clave son operaciones atómicas — no hay una escritura parcial que otro
# hilo pueda ver a medio hacer.
_ultima_deteccion: dict[int, DetectionFrameResult] = {}


def _obtener(db: Session, camara_id: int) -> Camara:
    camara = db.query(Camara).options(joinedload(Camara.sector)).filter(Camara.id == camara_id).first()
    if not camara:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")
    return camara


# Nombre de la constraint en la base, fijado por la revisión 6597e37ddeab.
_UNIQUE_NOMBRE = "camaras_nombre_unique"


def _nombre_ocupado(nombre: str) -> HTTPException:
    return HTTPException(
        status_code=409, detail=f"Ya existe una cámara con el nombre «{nombre}» (puede estar inactiva)"
    )


def _validar_nombre_libre(db: Session, nombre: str, excluir_id: Optional[int] = None) -> None:
    # Este chequeo da el mensaje lindo; el que garantiza la regla es el UNIQUE de
    # la base (T26-141), porque entre esta consulta y el commit se puede colar
    # otra alta con el mismo nombre. Ver _commit_sin_choque_de_nombre.
    query = db.query(Camara).filter(Camara.nombre == nombre)
    if excluir_id is not None:
        query = query.filter(Camara.id != excluir_id)
    if query.first():
        raise _nombre_ocupado(nombre)


@contextmanager
def _commit_sin_choque_de_nombre(db: Session, nombre: str):
    """Commitea traduciendo el choque contra camaras_nombre_unique al mismo 409.

    Es el otro extremo de _validar_nombre_libre: la consulta previa cubre el caso
    normal y esto cubre la carrera que la consulta no puede ver. Sin esto, agregar
    el UNIQUE habría cambiado un duplicado silencioso por un 500.

    Se mira exactamente qué constraint falló en vez de atrapar cualquier
    IntegrityError porque `camaras` también tiene la FK a `sectores`: si el sector
    desapareciera entre la validación y el commit, contestar «ya existe una cámara
    con ese nombre» sería mentir sobre lo que pasó. De eso se ocupa
    es_violacion_unique, que sabe que cada motor nombra el choque a su manera.
    """
    try:
        yield
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if not es_violacion_unique(error, _UNIQUE_NOMBRE, "nombre"):
            raise
        raise _nombre_ocupado(nombre) from error


def _refrescar(db: Session, camara: Camara) -> Camara:
    db.refresh(camara)
    db.refresh(camara, attribute_names=["sector"])
    return camara


@contextmanager
def _errores_de_cifrado():
    """Traduce un problema con CAMARA_ENCRYPTION_KEYS a un 500 explicado (T26-136).

    Es un fallo de despliegue, no de quien llama: la clave falta, está mal escrita
    o se rotó sin recifrar las filas. El mensaje del servicio ya dice qué revisar y
    no contiene secretos, así que se devuelve tal cual — el router entero es
    admin-only. Sin esto saldría un 500 pelado y habría que ir al log del servidor
    para enterarse de algo que se arregla tocando el .env."""
    try:
        yield
    except (cifrado.ClaveNoConfigurada, cifrado.NoSePudoDescifrar) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/", response_model=list[CamaraResponse], dependencies=ADMIN_O_VISION)
def listar_camaras(
    sector_id: Optional[int] = Query(None),
    incluir_inactivas: bool = Query(False),
    db: Session = Depends(get_db),
):
    query = db.query(Camara).options(joinedload(Camara.sector))
    if not incluir_inactivas:
        query = query.filter(Camara.activa == True)  # noqa: E712
    if sector_id is not None:
        query = query.filter(Camara.sector_id == sector_id)
    return query.order_by(Camara.id).all()


@router.get("/{camara_id}", response_model=CamaraResponse, dependencies=SOLO_ADMIN)
def obtener_camara(camara_id: int, db: Session = Depends(get_db)):
    return _obtener(db, camara_id)


@router.post("/", response_model=CamaraResponse, status_code=status.HTTP_201_CREATED, dependencies=SOLO_ADMIN)
def crear_camara(datos: CamaraCreate, db: Session = Depends(get_db)):
    validar_sector(db, datos.sector_id)
    _validar_nombre_libre(db, datos.nombre)
    campos = datos.model_dump()
    # La URL no se guarda textual: se parte en columnas y la contraseña va cifrada
    # (T26-136). El campo de entrada sigue siendo la URL entera para no cambiarle
    # el contrato al frontend.
    with _errores_de_cifrado():
        campos.update(Camara.partes_desde_url(campos.pop("rtsp_url")))
    camara = Camara(**campos)
    with _commit_sin_choque_de_nombre(db, datos.nombre):
        db.add(camara)
    return _refrescar(db, camara)


@router.patch("/{camara_id}", response_model=CamaraResponse, dependencies=SOLO_ADMIN)
def actualizar_camara(camara_id: int, datos: CamaraUpdate, db: Session = Depends(get_db)):
    camara = _obtener(db, camara_id)
    # exclude_unset (y no exclude_none como en mesas/sectores) para distinguir
    # "no toques este campo" de un valor mandado a propósito.
    cambios = datos.model_dump(exclude_unset=True)

    if "sector_id" in cambios:
        validar_sector(db, cambios["sector_id"])
    if "nombre" in cambios:
        _validar_nombre_libre(db, cambios["nombre"], excluir_id=camara.id)
    if "rtsp_url" in cambios:
        # Reemplaza las cinco columnas de conexión de una: mandar la URL implica
        # mandar la contraseña, así que no hay forma de editar el host dejando la
        # contraseña vieja sin querer.
        with _errores_de_cifrado():
            cambios.update(Camara.partes_desde_url(cambios.pop("rtsp_url")))

    with _commit_sin_choque_de_nombre(db, cambios.get("nombre", camara.nombre)):
        for campo, valor in cambios.items():
            setattr(camara, campo, valor)
    return _refrescar(db, camara)


@router.delete("/{camara_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=SOLO_ADMIN)
def desactivar_camara(camara_id: int, db: Session = Depends(get_db)):
    """Baja lógica: la cámara queda inactiva pero la fila no se borra, porque los
    ROI definidos sobre ella la siguen referenciando. Para reactivarla: PATCH con
    activa=true. Los ROI de la cámara NO se desactivan en cascada — quedan como
    estaban para que reactivarla no obligue a redibujarlos."""
    camara = _obtener(db, camara_id)
    camara.activa = False
    db.commit()


@router.post("/{camara_id}/test-conexion", response_model=CamaraTestResponse, dependencies=SOLO_ADMIN)
def probar_conexion_camara(
    camara_id: int,
    timeout_segundos: float = Query(rtsp.TIMEOUT_DEFECTO, ge=1, le=15),
    db: Session = Depends(get_db),
):
    """Intenta abrir el stream RTSP de la cámara y devuelve si respondió.

    Siempre contesta 200: que la cámara no conteste no es un error de la API, y
    el diagnóstico viaja en `ok` y `mensaje` para poder mostrarlo tal cual en la
    UI. Ver app/services/rtsp.py para cómo se hace la prueba."""
    camara = _obtener(db, camara_id)
    # Las partes van sueltas y no como URL armada: probar_conexion manda las
    # credenciales en la cabecera Authorization, así que la contraseña en claro
    # no llega a existir dentro de ninguna cadena que pudiera terminar en un log.
    with _errores_de_cifrado():
        password = camara.password
    resultado = rtsp.probar_conexion(
        camara.host, camara.puerto, camara.ruta, camara.usuario, password, timeout=timeout_segundos
    )
    return CamaraTestResponse(
        ok=resultado.ok,
        mensaje=resultado.mensaje,
        codigo_rtsp=resultado.codigo_rtsp,
        latencia_ms=resultado.latencia_ms,
        rtsp_url=camara.rtsp_url_enmascarada,
    )


@router.post("/test-conexion", response_model=CamaraTestResponse, dependencies=SOLO_ADMIN)
def probar_conexion_url(
    datos: CamaraTestUrlRequest,
    timeout_segundos: float = Query(rtsp.TIMEOUT_DEFECTO, ge=1, le=15),
):
    """Prueba una URL RTSP antes de dar de alta la cámara (T26-142).

    Mismo resultado que POST /{camara_id}/test-conexion pero sin cámara guardada
    de por medio: la UI puede probar la URL que el usuario está cargando en el
    formulario de alta antes de mandar el POST que la persiste. No hay nada que
    descifrar acá (la contraseña viaja en el propio body, no en una columna
    cifrada), así que a diferencia del endpoint con {camara_id} no hace falta
    _errores_de_cifrado."""
    resultado = rtsp.probar_url(datos.rtsp_url, timeout=timeout_segundos)
    return CamaraTestResponse(
        ok=resultado.ok,
        mensaje=resultado.mensaje,
        codigo_rtsp=resultado.codigo_rtsp,
        latencia_ms=resultado.latencia_ms,
        rtsp_url=rtsp.enmascarar_url(datos.rtsp_url),
    )


@router.get("/{camara_id}/snapshot", dependencies=SOLO_ADMIN)
def capturar_snapshot(
    camara_id: int,
    timeout_segundos: float = Query(rtsp.TIMEOUT_DEFECTO, ge=1, le=15),
    db: Session = Depends(get_db),
):
    """Captura un frame actual de la cámara para calibrar el ROI (T26-134, RF-12).

    A diferencia de `test-conexion`, acá hace falta decodificar el stream, no
    solo hablar el protocolo: `app/services/rtsp.py` confirma que la cámara
    responde pero no entrega frames. Por eso este endpoint sí usa OpenCV
    (backend FFMPEG, incluido en el propio wheel de opencv-python-headless, sin
    depender de que el sistema tenga ffmpeg instalado aparte).

    El timeout se pasa en el propio constructor de VideoCapture, no con
    `.set()` después de crearlo: seteado después, `CAP_PROP_OPEN_TIMEOUT_MSEC`
    se pierde en silencio (no hay backend abierto todavía que lo retenga) y la
    apertura cae al valor por defecto de OpenCV (~30 s) en vez del que pidió
    quien llama. Verificado a mano contra un host que no responde.
    """
    camara = _obtener(db, camara_id)
    if not camara.activa:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")

    timeout_ms = int(timeout_segundos * 1000)
    parametros = [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms,
    ]
    # Acá sí hace falta la URL completa: OpenCV no tiene por dónde recibir las
    # credenciales aparte. Es el único lugar donde la contraseña en claro forma
    # parte de una cadena; se descifra por cámara, en el momento, y no se loguea.
    with _errores_de_cifrado():
        url_completa = camara.rtsp_url_completa
    captura = cv2.VideoCapture(url_completa, cv2.CAP_FFMPEG, parametros)
    try:
        if not captura.isOpened():
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"La cámara «{camara.nombre}» no respondió en {timeout_segundos:g} segundos",
            )
        capturado, frame = captura.read()
    finally:
        captura.release()

    if not capturado or frame is None:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"La cámara «{camara.nombre}» abrió el stream pero no se pudo leer un frame",
        )

    codificado, buffer = cv2.imencode(".jpg", frame)
    if not codificado:
        raise HTTPException(
            status_code=500, detail="No se pudo codificar el frame capturado como JPEG"
        )

    return Response(content=buffer.tobytes(), media_type="image/jpeg")


# Cadencia del stream en vivo. No se copia la de la cámara: a 25-30 fps el costo de
# recomprimir cada frame a JPEG se vuelve el cuello de botella del backend, y para mirar
# un salón no aporta nada sobre 10. Es el parámetro a bajar si el CPU sufre.
STREAM_FPS = 10

# Calidad JPEG de cada frame. 70 es el punto donde la imagen sigue siendo clara y el
# tamaño cae a menos de la mitad que con el default de OpenCV (95). En MJPEG cada frame
# viaja entero, sin compresión entre frames, así que este número manda el ancho de banda.
STREAM_CALIDAD_JPEG = 70

# Cuántas lecturas fallidas seguidas se toleran antes de dar el stream por cortado. Un
# frame suelto puede fallar sin que la cámara se haya caído; una racha, no.
STREAM_FALLOS_TOLERADOS = 15

# Ancho al que se reduce cada frame antes de comprimirlo. La cámara entrega 1920x1080 y
# la vista del navegador es una miniatura: mandar el frame entero medido daba 288 KB por
# frame y 17 Mbps, casi todo desperdiciado en píxeles que el <img> descarta al escalar.
# A 640 la imagen sigue viéndose nítida en pantallas HiDPI y el costo cae un orden de
# magnitud, tanto en ancho de banda como en tiempo de compresión. Nunca se agranda un
# frame que ya venga más chico.
STREAM_ANCHO_MAXIMO = 640

_FRONTERA_MJPEG = "frame"


@router.get("/{camara_id}/stream", dependencies=SOLO_ADMIN)
def transmitir_camara(
    camara_id: int,
    timeout_segundos: float = Query(rtsp.TIMEOUT_DEFECTO, ge=1, le=15),
    ancho_maximo: int = Query(STREAM_ANCHO_MAXIMO, ge=160, le=1920),
    db: Session = Depends(get_db),
):
    """Vista en vivo de la cámara como MJPEG (T26-203, RF-31).

    Por qué MJPEG y no el RTSP directo: ningún navegador reproduce RTSP. Alguien tiene
    que reempaquetar el stream, y `multipart/x-mixed-replace` es la forma que no agrega
    dependencias — OpenCV ya está acá por el snapshot, y del otro lado lo entiende
    cualquier navegador sin librería de por medio.

    Diferencia con `/snapshot`, que es la que justifica este endpoint: snapshot abre una
    conexión RTSP, lee un frame y la cierra. Pedirlo en loop para simular video abriría
    una conexión por frame, que es lo caro. Acá la conexión se abre UNA vez y se mantiene
    mientras el cliente esté escuchando.

    El costo de esto no es gratis y conviene tenerlo presente: mientras haya un navegador
    con la vista abierta, el backend sostiene una conexión RTSP, decodifica y recomprime a
    STREAM_FPS. Se corta solo cuando el cliente se va —el generador recibe GeneratorExit y
    libera la captura en el `finally`—, así que cerrar la pestaña alcanza.

    Igual que el resto del router, esto asume un solo worker (ver docs/vision-loop.md).
    """
    camara = _obtener(db, camara_id)
    if not camara.activa:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")

    timeout_ms = int(timeout_segundos * 1000)
    parametros = [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms,
    ]
    with _errores_de_cifrado():
        url_completa = camara.rtsp_url_completa

    # La captura se abre ACÁ y no dentro del generador para poder contestar con un error
    # HTTP si la cámara no responde. Una vez que el generador empezó a emitir, la respuesta
    # ya salió con 200 y no hay forma de cambiarle el código: un fallo posterior solo puede
    # cortar el stream.
    captura = cv2.VideoCapture(url_completa, cv2.CAP_FFMPEG, parametros)
    if not captura.isOpened():
        captura.release()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"La cámara «{camara.nombre}» no respondió en {timeout_segundos:g} segundos",
        )

    def generar():
        intervalo = 1 / STREAM_FPS
        fallos = 0
        try:
            while True:
                inicio = time.monotonic()
                capturado, frame = captura.read()
                if not capturado or frame is None:
                    fallos += 1
                    if fallos >= STREAM_FALLOS_TOLERADOS:
                        break
                    continue
                fallos = 0

                # Escalar ANTES de comprimir, no después: comprimir a resolución completa
                # para luego achicar pagaría el costo caro (el JPEG del frame grande) sin
                # ningún beneficio.
                alto, ancho = frame.shape[:2]
                if ancho > ancho_maximo:
                    escala = ancho_maximo / ancho
                    frame = cv2.resize(
                        frame,
                        (ancho_maximo, max(1, int(round(alto * escala)))),
                        interpolation=cv2.INTER_AREA,
                    )

                codificado, buffer = cv2.imencode(
                    ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), STREAM_CALIDAD_JPEG]
                )
                if not codificado:
                    continue

                datos = buffer.tobytes()
                yield (
                    f"--{_FRONTERA_MJPEG}\r\n"
                    f"Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(datos)}\r\n\r\n"
                ).encode() + datos + b"\r\n"

                # El sobrante del ciclo, no el intervalo entero: si decodificar y comprimir
                # ya se comió el presupuesto, no se duerme y se sigue de largo.
                resto = intervalo - (time.monotonic() - inicio)
                if resto > 0:
                    time.sleep(resto)
        finally:
            # Corre también cuando el cliente cierra la pestaña: el servidor cierra el
            # generador y esto suelta la conexión RTSP. Sin esto, cada vista abierta dejaría
            # una conexión colgada contra la cámara para siempre.
            captura.release()

    return StreamingResponse(
        generar(),
        media_type=f"multipart/x-mixed-replace; boundary={_FRONTERA_MJPEG}",
        # Un proxy o el navegador cacheando esto no tendría ningún sentido y además
        # rompería la vista en vivo.
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@router.post("/{camara_id}/deteccion-actual", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN_O_VISION)
def publicar_deteccion_actual(camara_id: int, datos: DetectionFrameResult, db: Session = Depends(get_db)):
    """Recibe el resultado de detección de un frame desde vision-module (T26-150).

    Sobrescribe lo que hubiera antes: no hay historial, solo el último valor por
    cámara (ver docs/privacidad-vision.md §3). Quien llama esto en la práctica es
    el usuario técnico de vision-module, no un admin humano: es uno de los dos
    endpoints del archivo que acepta el rol vision_module (T26-152, T26-164).
    """
    _obtener(db, camara_id)  # 404 si la cámara no existe: no guardar detecciones de una mesa fantasma
    _ultima_deteccion[camara_id] = datos


@router.get("/{camara_id}/deteccion-actual", response_model=DetectionFrameResult, dependencies=SOLO_ADMIN)
def obtener_deteccion_actual(camara_id: int, db: Session = Depends(get_db)):
    """Último resultado de detección publicado para esta cámara (T26-150), para polling del frontend.

    404 si todavía no llegó ninguno —vision-module recién arrancó, no está
    corriendo, o nunca pudo publicar— en vez de un cuerpo vacío: "no sé nada
    todavía" y "el último frame no tenía detecciones" son cosas distintas, y
    confundirlas le ocultaría al frontend que la vista en vivo está caída.
    """
    _obtener(db, camara_id)
    resultado = _ultima_deteccion.get(camara_id)
    if resultado is None:
        raise HTTPException(status_code=404, detail="Todavía no llegó ninguna detección para esta cámara")
    return resultado
