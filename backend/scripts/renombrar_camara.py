# Renombra la cámara de prueba de T26-134/T26-128 ("Tapo test E2E (T26-134)") a un nombre
# de producción real ("Cocina"), ahora que la pantalla de calibración de ROI (T26-128) ya
# la usó para probar contra hardware real y el nombre de test quedó pisando lo que debería
# ser el nombre definitivo de esa cámara.
#
# Mismo patrón que scripts/probar_snapshot.py: sin requests/httpx (alcanza con urllib de la
# stdlib para un puñado de pedidos puntuales), variables desde backend/.env vía load_dotenv(),
# y nunca imprime contraseñas — ni la de admin ni la de la cámara (acá ni siquiera hace falta
# tocar la URL RTSP: renombrar es un PATCH que solo toca el campo nombre).
#
# Uso (desde backend/, con el venv activado y backend/.env con TEST_ADMIN_EMAIL/PASSWORD):
#   python scripts/renombrar_camara.py

import json
import os
import sys
import urllib.error
import urllib.request

from dotenv import load_dotenv

load_dotenv()

BASE_URL = "http://127.0.0.1:8000"
NOMBRE_ACTUAL = "Tapo test E2E (T26-134)"
NOMBRE_NUEVO = "Cocina"

VARIABLES_REQUERIDAS = ["TEST_ADMIN_EMAIL", "TEST_ADMIN_PASSWORD"]


def _leer_variables() -> dict:
    valores = {nombre: os.getenv(nombre) for nombre in VARIABLES_REQUERIDAS}
    faltantes = [nombre for nombre, valor in valores.items() if not valor]
    if faltantes:
        print("Faltan estas variables en backend/.env (completalas y volvé a correr el script):")
        for nombre in faltantes:
            print(f"  - {nombre}")
        sys.exit(1)
    return valores


def _pedido(metodo: str, ruta: str, token: str = None, cuerpo: dict = None, timeout: float = 10):
    # Devuelve (status, cuerpo_crudo: bytes, content_type). Nunca lanza por un 4xx/5xx del
    # backend — solo corta si ni siquiera se pudo conectar.
    url = f"{BASE_URL}{ruta}"
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    headers = {"Content-Type": "application/json"} if datos is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    peticion = urllib.request.Request(url, data=datos, headers=headers, method=metodo)
    try:
        with urllib.request.urlopen(peticion, timeout=timeout) as respuesta:
            return respuesta.status, respuesta.read(), respuesta.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get("Content-Type", "")
    except urllib.error.URLError as error:
        print(f"No se pudo conectar con el backend en {BASE_URL}: {error.reason}")
        print("¿Está levantado con uvicorn? (uvicorn app.main:app, corriendo desde backend/)")
        sys.exit(1)


def _mensaje_seguro(cuerpo_crudo: bytes, content_type: str) -> str:
    # Mismo criterio defensivo que probar_snapshot.py: nunca se imprime el body crudo tal
    # cual, solo "detail" cuando es un string plano.
    if "application/json" not in content_type:
        return "(sin detalle: la respuesta no fue JSON)"
    try:
        cuerpo = json.loads(cuerpo_crudo)
    except (ValueError, UnicodeDecodeError):
        return "(sin detalle: no se pudo interpretar la respuesta)"
    detalle = cuerpo.get("detail") if isinstance(cuerpo, dict) else None
    return detalle if isinstance(detalle, str) else "(detalle omitido)"


def main():
    variables = _leer_variables()

    print("1/4 — Login como admin de prueba...")
    status, cuerpo, content_type = _pedido(
        "POST",
        "/auth/login",
        cuerpo={"email": variables["TEST_ADMIN_EMAIL"], "password": variables["TEST_ADMIN_PASSWORD"]},
    )
    if status != 200:
        print(f"   Login falló ({status}): {_mensaje_seguro(cuerpo, content_type)}")
        sys.exit(1)
    token = json.loads(cuerpo)["access_token"]
    print("   OK")

    print(f"2/4 — Buscando la cámara «{NOMBRE_ACTUAL}»...")
    status, cuerpo, content_type = _pedido("GET", "/camaras/?incluir_inactivas=true", token=token)
    if status != 200:
        print(f"   No se pudo listar cámaras ({status}): {_mensaje_seguro(cuerpo, content_type)}")
        sys.exit(1)
    coincidencias = [c for c in json.loads(cuerpo) if c["nombre"] == NOMBRE_ACTUAL]
    if not coincidencias:
        print(f"   No hay ninguna cámara llamada «{NOMBRE_ACTUAL}». Nada para renombrar.")
        sys.exit(1)
    camara_id = coincidencias[0]["id"]
    print(f"   encontrada, id={camara_id}")

    print(f"3/4 — Renombrando a «{NOMBRE_NUEVO}»...")
    status, cuerpo, content_type = _pedido(
        "PATCH", f"/camaras/{camara_id}", token=token, cuerpo={"nombre": NOMBRE_NUEVO}
    )
    if status != 200:
        print(f"   No se pudo renombrar ({status}): {_mensaje_seguro(cuerpo, content_type)}")
        sys.exit(1)
    print("   OK")

    print("4/4 — Confirmando con un GET...")
    status, cuerpo, content_type = _pedido("GET", f"/camaras/{camara_id}", token=token)
    if status != 200:
        print(f"   No se pudo confirmar ({status}): {_mensaje_seguro(cuerpo, content_type)}")
        sys.exit(1)
    nombre_confirmado = json.loads(cuerpo)["nombre"]
    if nombre_confirmado == NOMBRE_NUEVO:
        print(f"   Confirmado: cámara id={camara_id} ahora se llama «{nombre_confirmado}»")
    else:
        print(f"   ALERTA: la API devolvió el nombre «{nombre_confirmado}», no «{NOMBRE_NUEVO}» como se esperaba")
        sys.exit(1)


if __name__ == "__main__":
    main()
