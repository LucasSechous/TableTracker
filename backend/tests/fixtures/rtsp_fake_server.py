# Servidor RTSP mínimo para probar app/services/rtsp.py sin hardware (T26-140).
#
# Habla lo mismo que el cliente real: texto sobre TCP, respondiendo OPTIONS y
# DESCRIBE. Cada escenario (`ESCENARIO_*` más abajo) es una función que recibe
# la conexión aceptada y decide qué mandar — desde un 200 directo hasta un
# desafío Digest que valida la contraseña de verdad, para que un test con la
# contraseña equivocada falle por una razón real y no porque el fake server no
# se fija.
#
# `ServidorRtspFalso` es la parte reutilizable (acepta conexiones, corre el
# escenario en un hilo por conexión); reusarlo contra el futuro endpoint de
# snapshot (T26-134, ya implementado) no alcanza tal cual, porque ahí OpenCV
# necesita SETUP/PLAY y datos RTP de verdad — este servidor sólo entiende el
# handshake que usa test-conexion.

import base64
import hashlib
import re
import secrets
import socket
import threading
import time
from typing import Callable, Optional

_LINEA_PEDIDO = re.compile(r"^(\S+)\s+(\S+)\s+RTSP/\d\.\d$")
_PARAMS_AUTH = re.compile(r'(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))')


def _leer_pedido(conexion: socket.socket, timeout: float = 5.0) -> Optional[tuple[str, dict]]:
    """(método, cabeceras) del próximo pedido, o None si la conexión se cerró
    antes de mandar uno completo — es lo que pasa, por ejemplo, cuando el
    cliente decide no reintentar (sin usuario configurado) y cierra su lado."""
    conexion.settimeout(timeout)
    crudo = b""
    try:
        while b"\r\n\r\n" not in crudo and len(crudo) < 8192:
            trozo = conexion.recv(1024)
            if not trozo:
                return None
            crudo += trozo
    except (socket.timeout, OSError):
        return None

    texto = crudo.decode("utf-8", errors="replace")
    lineas = texto.split("\r\n")
    match = _LINEA_PEDIDO.match(lineas[0])
    metodo = match.group(1) if match else ""
    cabeceras = {}
    for linea in lineas[1:]:
        if not linea:
            break
        nombre, separador, valor = linea.partition(":")
        if separador:
            cabeceras[nombre.strip().lower()] = valor.strip()
    return metodo, cabeceras


def _responder(conexion, codigo, razon="", cabeceras=None, cseq=None):
    lineas = [f"RTSP/1.0 {codigo} {razon}".rstrip()]
    if cseq is not None:
        lineas.append(f"CSeq: {cseq}")
    for nombre, valor in (cabeceras or {}).items():
        lineas.append(f"{nombre}: {valor}")
    conexion.sendall(("\r\n".join(lineas) + "\r\n\r\n").encode("utf-8"))


class ServidorRtspFalso:
    """Levanta en 127.0.0.1:puerto-libre y corre `escenario` por cada conexión
    aceptada. Se usa como context manager: al salir cierra el socket y espera
    el hilo que acepta conexiones (que es daemon, así que un test que no llega
    a salir del `with` — por ejemplo por una aserción que falla — no deja el
    proceso de pytest colgado)."""

    def __init__(self, escenario: Callable[[socket.socket, int], None]):
        self._escenario = escenario
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._socket.bind(("127.0.0.1", 0))
        self._socket.listen(5)
        self.host, self.puerto = self._socket.getsockname()
        self._detener = threading.Event()
        self._hilo = threading.Thread(target=self._aceptar, daemon=True)
        self._intentos = 0

    def __enter__(self):
        self._hilo.start()
        return self

    def __exit__(self, *exc):
        self._detener.set()
        try:
            self._socket.close()
        except OSError:
            pass
        self._hilo.join(timeout=2)

    def _aceptar(self):
        self._socket.settimeout(0.5)
        while not self._detener.is_set():
            try:
                conexion, _ = self._socket.accept()
            except (socket.timeout, OSError):
                continue
            self._intentos += 1
            threading.Thread(
                target=self._atender, args=(conexion, self._intentos), daemon=True
            ).start()

    def _atender(self, conexion, numero_intento):
        try:
            self._escenario(conexion, numero_intento)
        except OSError:
            pass  # el cliente ya cortó — nada que responder
        finally:
            try:
                conexion.close()
            except OSError:
                pass


# ------------------------------------------------------------------ escenarios
#
# Cada uno devuelve la función que recibe (conexion, numero_intento). El
# número de intento sólo lo usa ESCENARIO_recupera_tras_cerrar; el resto lo
# ignora porque responde igual sin importar si es la conexión 1 o la 5.


def escenario_ok():
    """OPTIONS y DESCRIBE responden 200 sin pedir credenciales — la cámara no
    tiene contraseña configurada."""

    def _handler(conexion, _intento):
        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))

        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))

    return _handler


def escenario_codigo_fijo(codigo: int, razon: str = ""):
    """OPTIONS 200, DESCRIBE responde siempre `codigo` — para 404 y para un
    código sin mensaje mapeado en rtsp._MENSAJES (ej. 500), sin pedir auth."""

    def _handler(conexion, _intento):
        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))

        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, codigo, razon, cseq=pedido[1].get("cseq"))

    return _handler


def escenario_no_habla_rtsp():
    """Responde al primer pedido con basura que no matchea una línea de estado
    RTSP — simula «algo escucha en el puerto pero no es una cámara»."""

    def _handler(conexion, _intento):
        if _leer_pedido(conexion) is None:
            return
        conexion.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")

    return _handler


def escenario_401_sin_desafio():
    """OPTIONS 200, DESCRIBE 401 sin cabecera WWW-Authenticate — la cámara pide
    auth pero no dice cómo. El cliente no reintenta: no hay tercer pedido."""

    def _handler(conexion, _intento):
        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))

        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 401, "Unauthorized", cseq=pedido[1].get("cseq"))

    return _handler


def escenario_esquema_no_soportado(esquema: str = "NTLM"):
    """DESCRIBE 401 con un esquema de auth que rtsp.py no sabe resolver."""

    def _handler(conexion, _intento):
        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))

        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(
            conexion, 401, "Unauthorized",
            {"WWW-Authenticate": f'{esquema} realm="Camara"'}, cseq=pedido[1].get("cseq"),
        )

    return _handler


def _md5(texto: str) -> str:
    return hashlib.md5(texto.encode("utf-8")).hexdigest()


def _parsear_authorization(valor: str):
    esquema, _, resto = valor.partition(" ")
    params = {}
    for nombre, entrecomillado, suelto in _PARAMS_AUTH.findall(resto):
        params[nombre.lower()] = suelto if suelto else entrecomillado
    return esquema.strip().lower(), params


def escenario_digest(usuario: str, password: str, con_qop: bool, realm: str = "TableTracker Test"):
    """DESCRIBE 401 con un desafío Digest real (con o sin `qop`) y valida la
    respuesta del cliente recalculando el hash esperado con la contraseña
    correcta — si el cliente manda otra contraseña, el response no matchea y
    sigue devolviendo 401, igual que haría la cámara real."""
    nonce = secrets.token_hex(8)

    def _handler(conexion, _intento):
        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))

        pedido = _leer_pedido(conexion)  # DESCRIBE sin credenciales
        if pedido is None:
            return
        metodo, cabeceras = pedido
        desafio = f'Digest realm="{realm}", nonce="{nonce}"' + (', qop="auth"' if con_qop else "")
        _responder(conexion, 401, "Unauthorized", {"WWW-Authenticate": desafio}, cseq=cabeceras.get("cseq"))

        pedido = _leer_pedido(conexion)  # DESCRIBE reintentado, con Authorization
        if pedido is None:
            return
        metodo, cabeceras = pedido
        auth = cabeceras.get("authorization")
        if not auth:
            _responder(conexion, 401, "Unauthorized", cseq=cabeceras.get("cseq"))
            return

        esquema, params = _parsear_authorization(auth)
        correcto = esquema == "digest" and params.get("username") == usuario and _respuesta_valida(
            params, usuario, password, realm, "DESCRIBE"
        )
        if correcto:
            _responder(conexion, 200, "OK", cseq=cabeceras.get("cseq"))
        else:
            _responder(
                conexion, 401, "Unauthorized",
                {"WWW-Authenticate": f'Digest realm="{realm}", nonce="{nonce}"'},
                cseq=cabeceras.get("cseq"),
            )

    return _handler


def _respuesta_valida(params, usuario, password, realm, metodo) -> bool:
    uri = params.get("uri", "")
    ha1 = _md5(f"{usuario}:{realm}:{password}")
    ha2 = _md5(f"{metodo}:{uri}")
    if params.get("qop"):
        nc, cnonce = params.get("nc", ""), params.get("cnonce", "")
        esperado = _md5(f"{ha1}:{params.get('nonce', '')}:{nc}:{cnonce}:{params['qop']}:{ha2}")
    else:
        esperado = _md5(f"{ha1}:{params.get('nonce', '')}:{ha2}")
    return params.get("response") == esperado


def escenario_basic(usuario: str, password: str, realm: str = "TableTracker Test"):
    """Igual que escenario_digest pero con el esquema Basic: desafía, decodifica
    lo que manda el cliente en base64 y lo compara contra la credencial real."""

    def _handler(conexion, _intento):
        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))

        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _, cabeceras = pedido
        _responder(
            conexion, 401, "Unauthorized", {"WWW-Authenticate": f'Basic realm="{realm}"'},
            cseq=cabeceras.get("cseq"),
        )

        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _, cabeceras = pedido
        auth = cabeceras.get("authorization", "")
        correcto = False
        if auth.lower().startswith("basic "):
            try:
                decodificado = base64.b64decode(auth[6:].strip()).decode("utf-8")
                correcto = decodificado == f"{usuario}:{password}"
            except (ValueError, UnicodeDecodeError):
                correcto = False
        _responder(conexion, 200 if correcto else 401, "OK" if correcto else "Unauthorized", cseq=cabeceras.get("cseq"))

    return _handler


def escenario_recupera_tras_cerrar():
    """La PRIMERA conexión se corta sin responder nada — algunas cámaras hacen
    esto con el socket inicial. `rtsp._Conexion` reintenta una vez en una
    conexión nueva; esta segunda conexión sí contesta 200, así que la prueba
    completa tiene que dar ok=True pese al corte inicial."""

    def _handler(conexion, intento):
        if intento == 1:
            return  # cierra sin leer ni responder — lo hace el `finally` de _atender
        ok = escenario_ok()
        ok(conexion, intento)

    return _handler


def escenario_cuelga(duracion_segundos: float = 2.0):
    """Acepta y responde OPTIONS, pero al DESCRIBE no contesta nada por
    `duracion_segundos` — más que el timeout que use el test — para forzar
    socket.timeout del lado del cliente."""

    def _handler(conexion, _intento):
        pedido = _leer_pedido(conexion)
        if pedido is None:
            return
        _responder(conexion, 200, "OK", cseq=pedido[1].get("cseq"))
        _leer_pedido(conexion, timeout=duracion_segundos + 5)  # recibe el DESCRIBE y no le contesta
        time.sleep(duracion_segundos)

    return _handler
