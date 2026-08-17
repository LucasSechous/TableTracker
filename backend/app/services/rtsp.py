# Prueba de conexión contra una cámara RTSP.
#
# En vez de levantar un decodificador de video (OpenCV/ffmpeg son ~100 MB de
# dependencias solo para esto, y el backend no procesa video: de eso se encarga
# vision-module), se hace el handshake del propio protocolo. RTSP es texto sobre
# TCP, muy parecido a HTTP/1.0:
#
#   - OPTIONS  confirma que del otro lado hay efectivamente un servidor RTSP.
#   - DESCRIBE confirma que el stream pedido existe y que las credenciales sirven.
#
# Es exactamente lo que hace un cliente real antes de empezar a recibir video, así
# que si DESCRIBE devuelve 200 la cámara responde y el stream se puede abrir.

import base64
import hashlib
import re
import secrets
import socket
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote, unquote, urlsplit, urlunsplit

TIMEOUT_DEFECTO = 5.0
PUERTO_RTSP_DEFECTO = 554
ESQUEMAS = ("rtsp", "rtsps")
# Reemplazo de la contraseña al mostrar una URL. También sirve de centinela: si
# llega en una alta o edición es que el cliente devolvió la URL enmascarada que
# le dimos nosotros, no una contraseña real (ver schemas/camara.py).
PASSWORD_ENMASCARADA = "***"

_USER_AGENT = "TableTracker/1.0"
# Alcanza con las cabeceras: el SDP del cuerpo no se usa y no conviene leer de más.
_MAX_RESPUESTA = 8192
_LINEA_ESTADO = re.compile(r"^RTSP/\d\.\d\s+(\d{3})\s*(.*)$")
_PARAMS_DESAFIO = re.compile(r'(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))')

_MENSAJES = {
    200: "Conexión correcta: la cámara respondió al stream solicitado",
    401: "Credenciales incorrectas: la cámara rechazó el usuario o la contraseña",
    403: "La cámara aceptó las credenciales pero no autoriza el acceso a este stream",
    404: "La ruta del stream no existe en la cámara: revisá el campo «ruta»",
    453: "La cámara no tiene ancho de banda disponible para otra conexión",
    455: "La cámara rechazó el pedido en su estado actual (¿el stream ya está en uso?)",
    503: "La cámara está saturada o fuera de servicio en este momento",
}


@dataclass
class ResultadoPrueba:
    ok: bool
    mensaje: str
    codigo_rtsp: Optional[int] = None
    latencia_ms: Optional[int] = None


@dataclass
class DatosConexion:
    host: str
    puerto: int
    ruta: str
    usuario: Optional[str]
    password: Optional[str]


@dataclass
class _Respuesta:
    codigo: Optional[int]
    razon: str
    cabeceras: dict


class _PruebaFallida(Exception):
    # Corta la prueba con un diagnóstico ya redactado. La latencia la completa
    # probar_conexion, que es la única que sabe cuándo arrancó.
    def __init__(self, mensaje, codigo_rtsp=None):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.codigo_rtsp = codigo_rtsp


def construir_url(host, puerto, ruta, usuario=None, password=None) -> str:
    # URL RTSP completa. Con credenciales solo para consumo interno (por ejemplo
    # pasársela a un reproductor): para mostrar en la UI está Camara.url_rtsp,
    # que va enmascarada.
    credenciales = ""
    if usuario:
        credenciales = quote(usuario, safe="")
        if password:
            credenciales += f":{quote(password, safe='')}"
        credenciales += "@"
    return f"rtsp://{credenciales}{host}:{puerto}{ruta}"


def parsear_url(rtsp_url) -> DatosConexion:
    # Descompone la URL guardada en camaras.rtsp_url. Lanza ValueError con un
    # mensaje mostrable si no sirve como URL de cámara.
    try:
        partes = urlsplit(rtsp_url.strip())
        puerto = partes.port or PUERTO_RTSP_DEFECTO
    except ValueError as error:
        raise ValueError(f"no se pudo interpretar ({error})") from error

    if partes.scheme.lower() not in ESQUEMAS:
        raise ValueError("tiene que empezar con rtsp:// o rtsps://")
    if not partes.hostname:
        raise ValueError("no indica el host de la cámara")

    # La query es parte de la ruta del stream en varias marcas (?channel=1&subtype=0).
    ruta = partes.path or "/"
    if partes.query:
        ruta = f"{ruta}?{partes.query}"

    return DatosConexion(
        host=partes.hostname,
        puerto=puerto,
        ruta=ruta,
        usuario=unquote(partes.username) if partes.username else None,
        password=unquote(partes.password) if partes.password else None,
    )


def enmascarar_url(rtsp_url) -> str:
    # La misma URL pero sin la contraseña, para respuestas de la API y logs.
    try:
        partes = urlsplit(rtsp_url)
        puerto = partes.port
        if not partes.password:
            return rtsp_url
    except ValueError:
        # URL rota: no se puede enmascarar por partes, así que no se muestra nada.
        return "rtsp://(url inválida)"

    autoridad = f"{partes.username}:{PASSWORD_ENMASCARADA}@{partes.hostname}"
    if puerto:
        autoridad += f":{puerto}"
    return urlunsplit((partes.scheme, autoridad, partes.path, partes.query, partes.fragment))


def probar_url(rtsp_url, timeout=TIMEOUT_DEFECTO) -> ResultadoPrueba:
    # Punto de entrada desde la API: parte de la URL guardada en la cámara.
    try:
        datos = parsear_url(rtsp_url)
    except ValueError as error:
        return ResultadoPrueba(False, f"La URL de la cámara no es válida: {error}")
    return probar_conexion(
        datos.host, datos.puerto, datos.ruta, datos.usuario, datos.password, timeout
    )


def probar_conexion(host, puerto, ruta, usuario=None, password=None, timeout=TIMEOUT_DEFECTO) -> ResultadoPrueba:
    # Nunca lanza por culpa de la cámara: un fallo de conexión es un resultado
    # válido de la prueba, no un error del backend.
    url = construir_url(host, puerto, ruta)  # sin credenciales: van en Authorization
    inicio = time.monotonic()

    def latencia():
        return int((time.monotonic() - inicio) * 1000)

    conexion = _Conexion(host, puerto, timeout)
    try:
        opciones = conexion.solicitar("OPTIONS", url, 1)
        if opciones.codigo is None:
            raise _PruebaFallida(f"Hay algo escuchando en {host}:{puerto}, pero no habla RTSP")

        cabeceras = {"Accept": "application/sdp"}
        describe = conexion.solicitar("DESCRIBE", url, 2, cabeceras)

        if describe.codigo == 401:
            describe = _reintentar_autenticado(conexion, url, cabeceras, describe, usuario, password)

        return _interpretar(describe, latencia())

    except _PruebaFallida as fallo:
        return ResultadoPrueba(False, fallo.mensaje, fallo.codigo_rtsp, latencia())
    except _ConexionCerrada:
        return ResultadoPrueba(
            False, f"{host}:{puerto} cortó la conexión sin llegar a responder", latencia_ms=latencia()
        )
    except socket.gaierror:
        return ResultadoPrueba(False, f"No se pudo resolver el host «{host}»", latencia_ms=latencia())
    except socket.timeout:
        return ResultadoPrueba(
            False, f"La cámara no respondió en {timeout:g} segundos", latencia_ms=latencia()
        )
    except ConnectionRefusedError:
        return ResultadoPrueba(
            False,
            f"{host}:{puerto} rechazó la conexión: revisá el puerto y que la cámara esté encendida",
            latencia_ms=latencia(),
        )
    except OSError as error:
        detalle = error.strerror or str(error)
        return ResultadoPrueba(
            False, f"No se pudo conectar con {host}:{puerto} ({detalle})", latencia_ms=latencia()
        )
    finally:
        conexion.cerrar()


def _reintentar_autenticado(conexion, url, cabeceras, respuesta_401, usuario, password) -> _Respuesta:
    # Repite el DESCRIBE resolviendo el desafío que mandó la cámara en el 401.
    if not usuario:
        raise _PruebaFallida("La cámara pide autenticación y no tiene usuario configurado", 401)

    desafio = respuesta_401.cabeceras.get("www-authenticate")
    if not desafio:
        raise _PruebaFallida("La cámara rechazó el acceso sin indicar cómo autenticarse", 401)

    autorizacion = _construir_authorization(desafio, usuario, password or "", "DESCRIBE", url)
    if autorizacion is None:
        esquema = desafio.split(" ", 1)[0]
        raise _PruebaFallida(
            f"La cámara pide un método de autenticación no soportado ({esquema})", 401
        )

    return conexion.solicitar("DESCRIBE", url, 3, {**cabeceras, "Authorization": autorizacion})


class _ConexionCerrada(Exception):
    """La cámara cortó el socket; se puede reintentar en una conexión nueva."""


class _Conexion:
    # Mantiene UNA sola conexión TCP para toda la prueba.
    #
    # Que sea la misma para OPTIONS, DESCRIBE y el DESCRIBE autenticado no es un
    # detalle de eficiencia: los servidores basados en LIVE555 (muy comunes en
    # cámaras IP) atan el nonce del desafío Digest a la conexión que lo emitió.
    # Reintentar en un socket nuevo devuelve 401 para siempre, aunque el usuario
    # y la contraseña sean correctos. Es lo que hace cualquier cliente real.
    #
    # Aun así, otras cámaras cierran el socket apenas contestan, así que si el
    # envío falla se reintenta una vez en una conexión nueva.

    def __init__(self, host, puerto, timeout):
        self.host = host
        self.puerto = puerto
        self.timeout = timeout
        self.sock = None

    def solicitar(self, metodo, url, cseq, cabeceras=None) -> _Respuesta:
        lineas = [f"{metodo} {url} RTSP/1.0", f"CSeq: {cseq}", f"User-Agent: {_USER_AGENT}"]
        lineas += [f"{nombre}: {valor}" for nombre, valor in (cabeceras or {}).items()]
        peticion = ("\r\n".join(lineas) + "\r\n\r\n").encode("utf-8")

        if self.sock is None:
            self._abrir()
        try:
            return self._intercambiar(peticion)
        except _ConexionCerrada:
            self.cerrar()
            self._abrir()
            return self._intercambiar(peticion)

    def _abrir(self):
        self.sock = socket.create_connection((self.host, self.puerto), timeout=self.timeout)
        self.sock.settimeout(self.timeout)

    def _intercambiar(self, peticion) -> _Respuesta:
        # El corte puede aparecer tanto al enviar como al recibir: si la cámara ya
        # cerró, en Windows el sendall suele pasar (queda en el buffer) y el error
        # salta recién en el recv. ConnectionError cubre reset, abort y broken pipe;
        # el timeout NO entra acá y sigue de largo, que es lo que queremos.
        try:
            self.sock.sendall(peticion)
            crudo = b""
            while b"\r\n\r\n" not in crudo and len(crudo) < _MAX_RESPUESTA:
                trozo = self.sock.recv(1024)
                if not trozo:
                    break
                crudo += trozo
        except ConnectionError as error:
            raise _ConexionCerrada from error

        if not crudo:
            raise _ConexionCerrada
        return _parsear(crudo.decode("utf-8", errors="replace"))

    def cerrar(self):
        if self.sock is not None:
            self.sock.close()
            self.sock = None


def _parsear(texto) -> _Respuesta:
    lineas = texto.split("\r\n")
    estado = _LINEA_ESTADO.match(lineas[0]) if lineas else None
    if not estado:
        return _Respuesta(None, "", {})

    cabeceras = {}
    for linea in lineas[1:]:
        if not linea:
            break
        nombre, separador, valor = linea.partition(":")
        if separador:
            cabeceras[nombre.strip().lower()] = valor.strip()

    return _Respuesta(int(estado.group(1)), estado.group(2).strip(), cabeceras)


def _interpretar(respuesta, latencia_ms) -> ResultadoPrueba:
    if respuesta.codigo is None:
        return ResultadoPrueba(False, "La cámara devolvió una respuesta ilegible", latencia_ms=latencia_ms)
    if respuesta.codigo == 200:
        return ResultadoPrueba(True, _MENSAJES[200], 200, latencia_ms)

    mensaje = _MENSAJES.get(respuesta.codigo)
    if mensaje is None:
        detalle = f" ({respuesta.razon})" if respuesta.razon else ""
        mensaje = f"La cámara respondió RTSP {respuesta.codigo}{detalle}"
    return ResultadoPrueba(False, mensaje, respuesta.codigo, latencia_ms)


def _md5(texto) -> str:
    # MD5 lo impone el esquema Digest de RTSP/HTTP (RFC 2617), no es una elección
    # nuestra: es lo que las cámaras esperan recibir.
    return hashlib.md5(texto.encode("utf-8")).hexdigest()


def _construir_authorization(desafio, usuario, password, metodo, url) -> Optional[str]:
    # Devuelve el valor de la cabecera Authorization, o None si el esquema que
    # pide la cámara no es Basic ni Digest.
    esquema, _, resto = desafio.partition(" ")
    esquema = esquema.lower()

    if esquema == "basic":
        return "Basic " + base64.b64encode(f"{usuario}:{password}".encode()).decode()
    if esquema != "digest":
        return None

    params = {}
    for nombre, entrecomillado, suelto in _PARAMS_DESAFIO.findall(resto):
        params[nombre.lower()] = suelto if suelto else entrecomillado

    realm = params.get("realm", "")
    nonce = params.get("nonce", "")
    ha1 = _md5(f"{usuario}:{realm}:{password}")
    ha2 = _md5(f"{metodo}:{url}")

    partes = [f'username="{usuario}"', f'realm="{realm}"', f'nonce="{nonce}"', f'uri="{url}"']
    # qop es opcional: muchas cámaras usan el Digest "clásico" sin él.
    if "auth" in [q.strip() for q in params.get("qop", "").split(",")]:
        nc, cnonce = "00000001", secrets.token_hex(8)
        partes.append(f'response="{_md5(f"{ha1}:{nonce}:{nc}:{cnonce}:auth:{ha2}")}"')
        partes += ["qop=auth", f"nc={nc}", f'cnonce="{cnonce}"']
    else:
        partes.append(f'response="{_md5(f"{ha1}:{nonce}:{ha2}")}"')

    if "opaque" in params:
        partes.append(f'opaque="{params["opaque"]}"')

    return "Digest " + ", ".join(partes)
