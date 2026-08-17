# Reconstrucción de la URL RTSP de la cámara.
#
# La contraseña de la cámara nunca sale de la API: `GET /camaras/` devuelve la
# URL con la contraseña reemplazada por «***» (ver backend/app/services/rtsp.py
# y docs/camaras-roi.md). Del backend salen entonces host, puerto, ruta y
# usuario —el registro de qué cámara es— y la contraseña la aporta el módulo
# desde su propio .env, así que el secreto no viaja por HTTP.
#
# El mismo criterio aplica al log: nada de lo que se escribe acá lleva la
# contraseña en claro, para eso está enmascarar().

from urllib.parse import quote, urlsplit, urlunsplit

# Mismo centinela que usa el backend al enmascarar.
PASSWORD_ENMASCARADA = "***"


def _partes(url):
    partes = urlsplit(str(url))
    if not partes.hostname:
        raise ValueError(f"La URL RTSP no tiene host: {url!r}")
    return partes


def _usuario_y_host(partes):
    # Se parte el netloc a mano en vez de usar .username/.hostname porque esas
    # propiedades normalizan (bajan el host a minúsculas, sueltan los corchetes
    # de IPv6) y acá lo que se quiere es devolver la URL tal como vino, con lo
    # único distinto siendo la contraseña.
    credenciales, _, host_puerto = partes.netloc.rpartition("@")
    usuario = credenciales.partition(":")[0]
    return usuario, host_puerto


def tiene_password_enmascarada(url):
    # Si la URL viene tapada hay que completarla antes de poder abrir el stream.
    return _partes(url).password == PASSWORD_ENMASCARADA


def con_password(url, password):
    """Devuelve la misma URL con `password` en lugar de la contraseña que trae.

    Se reconstruye el netloc entero en vez de reemplazar «***» como texto porque
    la contraseña puede traer caracteres que parten la URL en otro lado (`@` y
    `:`, sobre todo); así se percent-encodean una sola vez y en el lugar
    correcto. El usuario se deja tal cual vino: ya llega codificado del backend.
    """
    partes = _partes(url)
    usuario, host_puerto = _usuario_y_host(partes)
    if not usuario:
        raise ValueError(
            f"La URL RTSP no tiene usuario, no se le puede poner contraseña: {enmascarar(url)}"
        )
    netloc = f"{usuario}:{quote(password, safe='')}@{host_puerto}"
    return urlunsplit(partes._replace(netloc=netloc))


def enmascarar(url):
    """La fuente de video lista para loguear: si es una URL con credenciales, con
    la contraseña tapada; si no (índice de webcam, ruta de archivo), tal cual.

    No se apoya en _partes() ni en .password: una URL rota igual puede llevar una
    contraseña, y acá conviene fallar tapando de más antes que dejar el secreto
    en el log.
    """
    texto = str(url)
    try:
        partes = urlsplit(texto)
    except ValueError:
        return "<url ilegible>"
    if "@" not in partes.netloc:
        return texto
    usuario, host_puerto = _usuario_y_host(partes)
    netloc = f"{usuario}:{PASSWORD_ENMASCARADA}@{host_puerto}"
    return urlunsplit(partes._replace(netloc=netloc))
