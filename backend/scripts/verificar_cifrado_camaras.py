# Verificación de T26-136: las contraseñas RTSP quedan cifradas en la base.
#
# El backend todavía no tiene pytest, así que esto sigue la convención de los
# otros scripts de verificación del repo: se corre a mano, imprime cada chequeo y
# termina con código 1 si alguno falla. Levanta la API entera con TestClient
# contra un SQLite temporal — nunca toca Supabase — así que se puede correr en
# cualquier momento sin preparar nada.
#
# Uso (desde backend/, con el venv activado):
#   python scripts/verificar_cifrado_camaras.py

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Antes de importar nada de app: database.py arma el engine al importarse, y
# app/main.py corre create_all(). Sin esto, la verificación se conectaría a
# Supabase. load_dotenv() no pisa variables ya presentes en el entorno, así que
# alcanza con setearlas acá.
_BASE_TEMPORAL = Path(tempfile.mkdtemp(prefix="tabletracker-verif-")) / "verificacion.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_BASE_TEMPORAL.as_posix()}"
os.environ.setdefault("SECRET_KEY", "clave-de-prueba-para-la-verificacion")
os.environ.setdefault("ALGORITHM", "HS256")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.camara import Camara  # noqa: E402
from app.models.sector import Sector  # noqa: E402
from app.models.user import User  # noqa: E402
from app.routers.auth import get_usuario_actual  # noqa: E402
from app.services import cifrado, rtsp  # noqa: E402

CLAVE_A = cifrado.generar_clave()
CLAVE_B = cifrado.generar_clave()

# La URL de la única cámara real que hay hoy en la base (id=5), con una
# contraseña inventada: sirve para verificar que lo que ve el frontend no cambia.
URL_REAL = "rtsp://Camara:s3cr3t0@192.168.1.15:554/stream1"
PASSWORD_REAL = "s3cr3t0"

_fallos = []
_total = 0


def check(descripcion, condicion, detalle=""):
    global _total
    _total += 1
    if condicion:
        print(f"  ok   {descripcion}")
    else:
        print(f"  FALLA {descripcion}" + (f" — {detalle}" if detalle else ""))
        _fallos.append(descripcion)


def usar_claves(*claves):
    os.environ[cifrado.VARIABLE_CLAVES] = ",".join(claves)
    cifrado._reiniciar_cache()


def sin_clave():
    os.environ.pop(cifrado.VARIABLE_CLAVES, None)
    cifrado._reiniciar_cache()


def lanza(excepcion, funcion):
    try:
        funcion()
    except excepcion:
        return True
    except Exception:
        return False
    return False


# ---------------------------------------------------------------- cifrado
def verificar_cifrado():
    print("\n[1] Servicio de cifrado")
    usar_claves(CLAVE_A)

    token = cifrado.cifrar(PASSWORD_REAL)
    check("cifrar/descifrar devuelve el original", cifrado.descifrar(token) == PASSWORD_REAL)
    check("el token no contiene la contraseña", PASSWORD_REAL not in token, token)
    check(
        "dos cifrados del mismo texto dan tokens distintos",
        cifrado.cifrar(PASSWORD_REAL) != cifrado.cifrar(PASSWORD_REAL),
    )
    check("None se guarda como None", cifrado.cifrar(None) is None)
    check("cadena vacía se guarda como None, no como token", cifrado.cifrar("") is None)
    check("descifrar(None) es None", cifrado.descifrar(None) is None)

    sin_clave()
    check("sin CAMARA_ENCRYPTION_KEYS, cifrar falla fuerte", lanza(cifrado.ClaveNoConfigurada, lambda: cifrado.cifrar("x")))
    check(
        "sin clave NO se cae en texto plano",
        lanza(cifrado.ClaveNoConfigurada, lambda: cifrado.descifrar(token)),
    )

    usar_claves("esto-no-es-una-clave-fernet")
    check("una clave con formato inválido falla al armarse", lanza(cifrado.ClaveNoConfigurada, lambda: cifrado.cifrar("x")))

    usar_claves(CLAVE_B)
    check("un token de otra clave no abre", lanza(cifrado.NoSePudoDescifrar, lambda: cifrado.descifrar(token)))

    print("\n[2] Rotación de clave")
    usar_claves(CLAVE_B, CLAVE_A)
    check("con la vieja detrás, lo viejo se sigue leyendo", cifrado.descifrar(token) == PASSWORD_REAL)
    nuevo = cifrado.recifrar(token)
    check("recifrar conserva el valor", cifrado.descifrar(nuevo) == PASSWORD_REAL)
    check("recifrar cambia el token", nuevo != token)

    usar_claves(CLAVE_B)
    check("tras recifrar, sacar la clave vieja no rompe nada", cifrado.descifrar(nuevo) == PASSWORD_REAL)
    check(
        "lo NO recifrado deja de abrir (y lo dice)",
        lanza(cifrado.NoSePudoDescifrar, lambda: cifrado.descifrar(token)),
    )


# ------------------------------------------------------------------- rtsp
def verificar_rtsp():
    print("\n[3] Armado y enmascarado de URLs")
    datos = rtsp.parsear_url(URL_REAL)
    check("parsear_url conserva el esquema", datos.esquema == "rtsp")
    check(
        "construir_url reconstruye la URL exacta",
        rtsp.construir_url(datos.host, datos.puerto, datos.ruta, datos.usuario, datos.password, datos.esquema)
        == URL_REAL,
    )

    enmascarada = rtsp.enmascarar_partes(datos.host, datos.puerto, datos.ruta, datos.usuario, True, datos.esquema)
    check(
        "enmascarar_partes coincide con el enmascarado viejo (el frontend no ve un cambio)",
        enmascarada == rtsp.enmascarar_url(URL_REAL),
        f"{enmascarada!r} != {rtsp.enmascarar_url(URL_REAL)!r}",
    )
    check("el centinela no queda percent-encoded", "%2A" not in enmascarada, enmascarada)
    check("la contraseña no aparece enmascarada", PASSWORD_REAL not in enmascarada)
    check(
        "sin contraseña no se inventa el centinela",
        rtsp.enmascarar_partes("h", 554, "/s", "u", False) == "rtsp://u@h:554/s",
    )
    check(
        "sin usuario tampoco",
        rtsp.enmascarar_partes("h", 554, "/s") == "rtsp://h:554/s",
    )

    # rtsps es RTSP sobre TLS: reconstruirlo como rtsp degradaría el stream.
    rtsps = rtsp.parsear_url("rtsps://u:p@h:322/s")
    check("rtsps se conserva al parsear", rtsps.esquema == "rtsps")
    check(
        "rtsps se conserva al reconstruir",
        rtsp.construir_url(rtsps.host, rtsps.puerto, rtsps.ruta, rtsps.usuario, rtsps.password, rtsps.esquema)
        == "rtsps://u:p@h:322/s",
    )

    # Una contraseña con caracteres reservados es el caso que rompe si se
    # concatena a mano en vez de escaparse.
    rara = "p@ss:w/rd?x"
    url_rara = rtsp.construir_url("h", 554, "/s", "us er", rara)
    check("una contraseña con @ : / ? sobrevive el round-trip", rtsp.parsear_url(url_rara).password == rara)
    check("un usuario con espacio también", rtsp.parsear_url(url_rara).usuario == "us er")


# ----------------------------------------------------------------- modelo
def verificar_modelo(db):
    print("\n[4] Modelo Camara contra la base")
    usar_claves(CLAVE_A)

    camara = Camara(nombre="Verificación", sector_id=1, **Camara.partes_desde_url(URL_REAL))
    db.add(camara)
    db.commit()
    db.refresh(camara)

    check("host se guarda en claro", camara.host == "192.168.1.15")
    check("puerto se guarda en claro", camara.puerto == 554)
    check("ruta se guarda en claro", camara.ruta == "/stream1")
    check("usuario se guarda en claro", camara.usuario == "Camara")
    check("la contraseña NO se guarda en claro", camara.password_cifrada != PASSWORD_REAL)

    # Lo que realmente importa del ticket: leer la fila cruda, como haría un
    # volcado de la tabla o el panel de Supabase, y no encontrar la contraseña.
    fila = db.execute(
        Camara.__table__.select().where(Camara.__table__.c.id == camara.id)
    ).mappings().one()
    check(
        "un volcado de la fila no contiene la contraseña",
        PASSWORD_REAL not in " ".join(str(v) for v in fila.values()),
        str(dict(fila)),
    )
    check("la columna vieja rtsp_url ya no existe", "rtsp_url" not in fila)

    check("password descifra el original", camara.password == PASSWORD_REAL)
    check("rtsp_url_completa reconstruye la URL original", camara.rtsp_url_completa == URL_REAL)
    check("rtsp_url_enmascarada tapa la contraseña", camara.rtsp_url_enmascarada == rtsp.enmascarar_url(URL_REAL))
    check("tiene_credenciales", camara.tiene_credenciales is True)

    # El enmascarado no debe descifrar: sacando la clave del entorno tiene que
    # seguir funcionando. Es lo que hace que listar N cámaras no pase N
    # contraseñas por memoria.
    sin_clave()
    check("rtsp_url_enmascarada NO descifra", camara.rtsp_url_enmascarada == rtsp.enmascarar_url(URL_REAL))
    usar_claves(CLAVE_A)

    sin_pass = Camara(nombre="Sin credenciales", sector_id=1, **Camara.partes_desde_url("rtsp://192.168.1.20:554/s"))
    db.add(sin_pass)
    db.commit()
    check("una cámara sin credenciales no guarda token", sin_pass.password_cifrada is None)
    check("tiene_credenciales es False sin usuario", sin_pass.tiene_credenciales is False)
    check("y se enmascara sin centinela", sin_pass.rtsp_url_enmascarada == "rtsp://192.168.1.20:554/s")

    db.delete(camara)
    db.delete(sin_pass)
    db.commit()


# -------------------------------------------------------------------- API
def verificar_api(cliente, db):
    print("\n[5] API de cámaras")
    usar_claves(CLAVE_A)

    respuesta = cliente.post(
        "/camaras/", json={"nombre": "API test", "rtsp_url": URL_REAL, "sector_id": 1}
    )
    check("POST /camaras/ crea la cámara", respuesta.status_code == 201, respuesta.text)
    cuerpo = respuesta.json()
    camara_id = cuerpo["id"]

    check("la respuesta no trae la contraseña", PASSWORD_REAL not in respuesta.text, respuesta.text)
    check("la respuesta trae la URL enmascarada", cuerpo["rtsp_url"] == rtsp.enmascarar_url(URL_REAL))
    check("la respuesta trae tiene_credenciales", cuerpo["tiene_credenciales"] is True)

    guardada = db.get(Camara, camara_id)
    db.refresh(guardada)
    check("quedó cifrada en la base", guardada.password_cifrada not in (None, PASSWORD_REAL))
    check("y descifra al valor correcto", guardada.password == PASSWORD_REAL)

    listado = cliente.get("/camaras/")
    check("GET /camaras/ responde", listado.status_code == 200, listado.text)
    check("el listado no filtra contraseñas", PASSWORD_REAL not in listado.text)

    # El listado no puede necesitar la clave: si la necesitara, cada GET pasaría
    # todas las contraseñas del local por memoria.
    sin_clave()
    listado_sin_clave = cliente.get("/camaras/")
    check("GET /camaras/ funciona sin la clave de cifrado", listado_sin_clave.status_code == 200, listado_sin_clave.text)

    # En cambio hablar con la cámara sí la necesita, y sin clave tiene que dar un
    # error explicado, no un 500 pelado ni un intento con la contraseña vacía.
    test_sin_clave = cliente.post(f"/camaras/{camara_id}/test-conexion")
    check("test-conexion sin clave da 500", test_sin_clave.status_code == 500, test_sin_clave.text)
    check(
        "…y el mensaje dice qué revisar",
        cifrado.VARIABLE_CLAVES in test_sin_clave.json().get("detail", ""),
        test_sin_clave.text,
    )
    usar_claves(CLAVE_A)

    # Reenviar la URL enmascarada tiene que seguir dando 422: es lo que evita
    # guardar «***» como contraseña real al editar solo el nombre.
    reenvio = cliente.patch(f"/camaras/{camara_id}", json={"rtsp_url": cuerpo["rtsp_url"]})
    check("PATCH con la URL enmascarada da 422", reenvio.status_code == 422, reenvio.text)

    nueva_url = "rtsp://otro:otraclave@10.0.0.9:8554/cam?channel=1"
    patch = cliente.patch(f"/camaras/{camara_id}", json={"rtsp_url": nueva_url})
    check("PATCH con una URL nueva responde 200", patch.status_code == 200, patch.text)
    db.expire_all()
    actualizada = db.get(Camara, camara_id)
    check("el PATCH reemplaza el host", actualizada.host == "10.0.0.9")
    check("el PATCH reemplaza el puerto", actualizada.puerto == 8554)
    check("el PATCH conserva la query de la ruta", actualizada.ruta == "/cam?channel=1")
    check("el PATCH reemplaza la contraseña", actualizada.password == "otraclave")
    check("«otraclave» no quedó en claro", "otraclave" not in str(actualizada.password_cifrada))

    solo_nombre = cliente.patch(f"/camaras/{camara_id}", json={"nombre": "Renombrada"})
    check("un PATCH que no toca la URL responde 200", solo_nombre.status_code == 200, solo_nombre.text)
    db.expire_all()
    check("…y no pierde la contraseña", db.get(Camara, camara_id).password == "otraclave")

    cliente.delete(f"/camaras/{camara_id}")


# --------------------------------------------------------------- migración
def verificar_migracion():
    print("\n[6] Lógica de migración (las 20 filas reales de Supabase)")
    usar_claves(CLAVE_A)

    # Las formas que hay hoy en la tabla, con contraseñas inventadas.
    urls = [
        "rtsp://Camara:s3cr3t0@192.168.1.15:554/stream1",
        "rtsp://user:pass@127.0.0.1:554/stream",
        "rtsp://user:pass@127.0.0.1:554/stream2",
        "rtsp://user:pass@127.0.0.1:554/x",
    ]
    for url in urls:
        partes = Camara.partes_desde_url(url)
        rehecha = rtsp.construir_url(
            partes["host"],
            partes["puerto"],
            partes["ruta"],
            partes["usuario"],
            cifrado.descifrar(partes["password_cifrada"]),
            partes["esquema"],
        )
        check(f"round-trip exacto de {rtsp.enmascarar_url(url)}", rehecha == url, rehecha)


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add(Sector(id=1, nombre="Verificación"))
    db.commit()

    # El router entero es admin-only. requiere_rol() devuelve un closure nuevo en
    # cada llamada, así que no se puede sobrescribir por identidad: se sobrescribe
    # get_usuario_actual, del que ese closure depende.
    app.dependency_overrides[get_usuario_actual] = lambda: User(
        id=1, nombre="Verificación", email="verif@test.local", password="x", rol="admin"
    )
    cliente = TestClient(app)

    try:
        verificar_cifrado()
        verificar_rtsp()
        verificar_modelo(db)
        verificar_api(cliente, db)
        verificar_migracion()
    finally:
        db.close()

    print(f"\n{'=' * 60}")
    if _fallos:
        print(f"{len(_fallos)} de {_total} chequeos FALLARON:")
        for fallo in _fallos:
            print(f"  - {fallo}")
        sys.exit(1)
    print(f"Los {_total} chequeos pasaron.")


if __name__ == "__main__":
    main()
