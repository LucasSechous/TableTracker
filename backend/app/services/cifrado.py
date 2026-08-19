# Cifrado de los secretos que el backend guarda en la base (T26-136).
#
# Hoy lo usa una sola cosa: la contraseña RTSP de cada cámara (camaras.password_cifrada).
# La necesidad es concreta: un volcado de la tabla, un backup o el panel de Supabase
# entregaban el acceso al video del local. Enmascararla en la respuesta de la API
# —que ya se hacía— no protege la base.
#
# Fernet (AES-128-CBC + HMAC-SHA256, de `cryptography`, que ya venía instalada como
# dependencia de python-jose) y no pgcrypto: con pgcrypto la clave viaja como
# argumento dentro de cada sentencia SQL, así que termina en los logs de consultas
# del servidor y a la vista de cualquiera con acceso a la base. Justo lo que este
# ticket quiere evitar. Cifrando en el backend, la base nunca ve la clave.
#
# ROTACIÓN. CAMARA_ENCRYPTION_KEYS admite varias claves separadas por coma:
#
#     CAMARA_ENCRYPTION_KEYS=<clave-nueva>,<clave-vieja>
#
# La primera es la activa (con esa se cifra); las demás solo se usan para descifrar.
# Eso permite rotar sin ventana de indisponibilidad: se agrega la nueva adelante, la
# API sigue leyendo lo viejo, y `scripts/rotar_clave_camaras.py` recifra las filas.
# Cuando termina, se saca la clave vieja del .env. Ver docs/camaras-roi.md.

import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

VARIABLE_CLAVES = "CAMARA_ENCRYPTION_KEYS"

# Se arma una sola vez y se cachea: derivar la clave en cada request es trabajo al
# pedo. _reiniciar_cache() existe para los scripts y las pruebas, que cambian la
# variable de entorno en caliente.
_cache: Optional[MultiFernet] = None
_claves_cacheadas: Optional[str] = None


class ClaveNoConfigurada(RuntimeError):
    """Falta CAMARA_ENCRYPTION_KEYS o no tiene un valor usable.

    Es a propósito un error y no un fallback a texto plano: si la clave no está,
    lo correcto es que el endpoint falle y se note, no que la contraseña se
    guarde en claro y nadie se entere.
    """


class NoSePudoDescifrar(ValueError):
    """El token no abre con ninguna de las claves configuradas.

    Casi siempre significa que se rotó la clave y se sacó la vieja del .env antes
    de recifrar las filas, o que el valor de la columna se tocó a mano.
    """


def generar_clave() -> str:
    """Una clave nueva, lista para pegar en CAMARA_ENCRYPTION_KEYS."""
    return Fernet.generate_key().decode()


def _multifernet() -> MultiFernet:
    global _cache, _claves_cacheadas

    crudo = os.getenv(VARIABLE_CLAVES, "")
    if _cache is not None and _claves_cacheadas == crudo:
        return _cache

    claves = [parte.strip() for parte in crudo.split(",") if parte.strip()]
    if not claves:
        raise ClaveNoConfigurada(
            f"Falta {VARIABLE_CLAVES} en backend/.env: sin esa clave no se pueden leer ni guardar "
            "las contraseñas de las cámaras. Generá una con "
            "`python -c \"from app.services.cifrado import generar_clave; print(generar_clave())\"`."
        )

    try:
        fernets = [Fernet(clave) for clave in claves]
    except (ValueError, TypeError) as error:
        raise ClaveNoConfigurada(
            f"{VARIABLE_CLAVES} tiene un valor que no es una clave Fernet válida ({error}). "
            "Tiene que ser una clave en base64 urlsafe de 32 bytes, o varias separadas por coma."
        ) from error

    _cache, _claves_cacheadas = MultiFernet(fernets), crudo
    return _cache


def _reiniciar_cache() -> None:
    # Para scripts y pruebas que cambian CAMARA_ENCRYPTION_KEYS en caliente.
    global _cache, _claves_cacheadas
    _cache, _claves_cacheadas = None, None


def cifrar(texto: Optional[str]) -> Optional[str]:
    """Cifra con la clave activa (la primera de la lista).

    None y "" pasan derecho como None: una cámara sin contraseña no guarda un
    token, guarda NULL. Cifrar la cadena vacía daría un token perfectamente
    válido y perderíamos la diferencia entre «no tiene contraseña» y «tiene una
    que resultó ser vacía».
    """
    if not texto:
        return None
    return _multifernet().encrypt(texto.encode()).decode()


def descifrar(token: Optional[str]) -> Optional[str]:
    """Descifra probando todas las claves configuradas, de la activa a la más vieja."""
    if not token:
        return None
    try:
        return _multifernet().decrypt(token.encode()).decode()
    except InvalidToken as error:
        raise NoSePudoDescifrar(
            f"El valor cifrado no abre con ninguna de las claves de {VARIABLE_CLAVES}. "
            "Si acabás de rotar la clave, volvé a agregar la anterior al final de la lista "
            "y corré scripts/rotar_clave_camaras.py."
        ) from error


def recifrar(token: Optional[str]) -> Optional[str]:
    """Pasa un token a la clave activa. Es lo que hace la rotación, fila por fila."""
    return cifrar(descifrar(token))
