# app/services/cifrado.py: cifrado de las contraseñas RTSP de las cámaras (T26-136).
#
# El servicio ya estaba ejercitado de refilón por test_camaras.py —todo alta de cámara
# cifra y todo test de conexión descifra— pero no había ninguna prueba que lo mirara
# solo. La diferencia no es cosmética: de refilón no se distingue "cifra" de "guarda el
# texto tal cual y lo devuelve", porque el ida y vuelta da el mismo resultado en los dos
# casos. Lo que hay que afirmar es que el token NO contiene la contraseña.
#
# La clave de la corrida la fija conftest.py una sola vez para toda la sesión
# (CAMARA_ENCRYPTION_KEYS), así que estos tests usan la misma que el resto de la suite.

import pytest
from cryptography.fernet import Fernet

from app.services.cifrado import NoSePudoDescifrar, cifrar, descifrar, generar_clave


def test_cifrar_y_descifrar_devuelve_el_texto_original():
    """Ida y vuelta, y la contraseña no se puede leer del token.

    El assert que justifica el ticket es el del medio: un volcado de la tabla, un backup
    o el panel de Supabase no tienen que entregar el acceso al video del local.
    """
    token = cifrar("s3cr3t0")

    assert token is not None
    assert token != "s3cr3t0"
    assert "s3cr3t0" not in token

    assert descifrar(token) == "s3cr3t0"

    # Fernet incluye un nonce, así que cifrar lo mismo dos veces da tokens distintos y
    # los dos abren. Sin eso, dos cámaras con la misma contraseña serían reconocibles
    # por tener el mismo valor en la columna.
    otro = cifrar("s3cr3t0")
    assert otro != token
    assert descifrar(otro) == "s3cr3t0"


def test_un_token_de_otra_clave_no_se_puede_descifrar():
    """Un token cifrado con una clave ajena falla con el error del dominio.

    Importa que sea `NoSePudoDescifrar` y no el `InvalidToken` crudo de la librería: es
    lo que los endpoints de cámaras atrapan para contestar un error explicado en vez de
    un 500. Este es el caso real de haber rotado la clave y sacado la vieja del `.env`
    antes de recifrar las filas.
    """
    ajeno = Fernet(generar_clave().encode()).encrypt(b"s3cr3t0").decode()

    with pytest.raises(NoSePudoDescifrar):
        descifrar(ajeno)


def test_sin_contrasena_se_guarda_none():
    """Ni `None` ni `""` generan token: una cámara sin contraseña guarda NULL.

    Cifrar la cadena vacía daría un token perfectamente válido, y entonces la columna no
    podría distinguir «esta cámara no tiene contraseña» de «tiene una que resultó ser
    vacía». La primera es una cámara abierta; la segunda, una mal cargada.
    """
    assert cifrar(None) is None
    assert cifrar("") is None
    assert descifrar(None) is None
    assert descifrar("") is None
