# Verificación manual de T26-134 (GET /camaras/{id}/snapshot): da de alta —o
# reutiliza— una cámara de prueba apuntando a la Tapo C310 real y le pide un
# snapshot al backend. No es parte de una suite de tests (el backend no tiene
# una, ver docs/camaras-roi.md): es un script para correr a mano, una vez,
# con el backend levantado y la cámara en la red.
#
# No usa requests ni httpx a propósito: el backend no trae un cliente HTTP
# como dependencia y este script hace apenas cuatro pedidos, así que alcanza
# con urllib de la stdlib (mismo criterio de "cero dependencias nuevas salvo
# imprescindible" que ya se sostuvo en T26-126 y se resolvió distinto recién
# con opencv-python-headless en T26-134, donde sí hacía falta).
#
# CRÍTICO: este script no imprime ni loguea contraseñas en ningún momento —
# ni la de admin ni la de la cámara. Si necesita mostrar la URL RTSP en algún
# mensaje, la enmascara con el mismo criterio que ya usa la API
# (app.services.rtsp.enmascarar_url). Ver el resto de precauciones en
# _mensaje_seguro().
#
# Uso (desde backend/, con el venv activado y backend/.env completo):
#   python scripts/probar_snapshot.py

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.rtsp import enmascarar_url  # noqa: E402

load_dotenv()

BASE_URL = "http://127.0.0.1:8000"
SALIDA_JPEG = Path(__file__).resolve().parent / "snapshot.jpg"
NOMBRE_CAMARA_TEST = "Tapo test E2E (T26-134)"

# Puerto y ruta RTSP por defecto de una Tapo C310 (stream principal). No son
# variables de entorno porque, a diferencia de la IP, no cambian entre
# corridas; si tu firmware usa otra ruta, ajustalo directamente acá.
PUERTO_RTSP = 554
RUTA_RTSP = "/stream1"

VARIABLES_REQUERIDAS = [
    "TEST_ADMIN_EMAIL",
    "TEST_ADMIN_PASSWORD",
    "CAMARA_TEST_USER",
    "CAMARA_TEST_PASSWORD",
    "CAMARA_TEST_IP",
    "CAMARA_TEST_SECTOR_ID",
]


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
    # Devuelve (status, cuerpo_crudo: bytes, content_type). Nunca lanza por un
    # 4xx/5xx del backend (eso es un resultado a mostrar, no un error del
    # script) — solo corta si ni siquiera se pudo conectar.
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
    # Nunca se imprime el body crudo tal cual: si la validación de Pydantic
    # rechaza rtsp_url, el 422 por defecto de FastAPI ecoa el valor que se
    # mandó —con la contraseña real adentro— en el campo "input" de cada
    # error. Por eso acá solo se muestra "detail" cuando es un string plano
    # (los errores propios de la API: 400/401/404/409/504), nunca la lista
    # cruda de errores de validación, que es la que podría traer el secreto.
    if "application/json" not in content_type:
        return "(sin detalle: la respuesta no fue JSON)"
    try:
        cuerpo = json.loads(cuerpo_crudo)
    except (ValueError, UnicodeDecodeError):
        return "(sin detalle: no se pudo interpretar la respuesta)"
    detalle = cuerpo.get("detail") if isinstance(cuerpo, dict) else None
    if isinstance(detalle, str):
        return detalle
    return "(detalle omitido: el formato de error puede incluir datos sensibles de CAMARA_TEST_*)"


def main():
    variables = _leer_variables()

    try:
        sector_id = int(variables["CAMARA_TEST_SECTOR_ID"])
    except ValueError:
        print("CAMARA_TEST_SECTOR_ID tiene que ser un número entero (el id de un sector existente).")
        sys.exit(1)

    rtsp_url = (
        f"rtsp://{quote(variables['CAMARA_TEST_USER'], safe='')}"
        f":{quote(variables['CAMARA_TEST_PASSWORD'], safe='')}"
        f"@{variables['CAMARA_TEST_IP']}:{PUERTO_RTSP}{RUTA_RTSP}"
    )

    print("1/3 — Login como admin de prueba...")
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

    print(f"2/3 — Dando de alta la cámara de prueba (URL: {enmascarar_url(rtsp_url)})...")
    status, cuerpo, content_type = _pedido(
        "POST",
        "/camaras/",
        token=token,
        cuerpo={"nombre": NOMBRE_CAMARA_TEST, "rtsp_url": rtsp_url, "sector_id": sector_id, "activa": True},
    )
    if status == 201:
        camara_id = json.loads(cuerpo)["id"]
        print(f"   creada, id={camara_id}")
    elif status == 409:
        print("   ya existía una cámara con ese nombre, buscando su id...")
        status_lista, cuerpo_lista, content_type_lista = _pedido(
            "GET", "/camaras/?incluir_inactivas=true", token=token
        )
        if status_lista != 200:
            print(f"   No se pudo listar cámaras para encontrar la existente ({status_lista}): "
                  f"{_mensaje_seguro(cuerpo_lista, content_type_lista)}")
            sys.exit(1)
        coincidencias = [c for c in json.loads(cuerpo_lista) if c["nombre"] == NOMBRE_CAMARA_TEST]
        if not coincidencias:
            print("   La API dijo 409 pero no la encontré en el listado. Abortando.")
            sys.exit(1)
        camara_id = coincidencias[0]["id"]
        print(f"   encontrada, id={camara_id}. Actualizando su URL (la IP puede haber cambiado por DHCP)...")
        status_patch, cuerpo_patch, content_type_patch = _pedido(
            "PATCH", f"/camaras/{camara_id}", token=token, cuerpo={"rtsp_url": rtsp_url, "activa": True}
        )
        if status_patch != 200:
            print(f"   No se pudo actualizar la URL de la cámara existente ({status_patch}): "
                  f"{_mensaje_seguro(cuerpo_patch, content_type_patch)}")
            sys.exit(1)
        print("   URL actualizada")
    else:
        print(f"   No se pudo dar de alta la cámara ({status}): {_mensaje_seguro(cuerpo, content_type)}")
        sys.exit(1)

    print(f"3/3 — Pidiendo snapshot de la cámara id={camara_id}...")
    status, cuerpo, content_type = _pedido(
        "GET", f"/camaras/{camara_id}/snapshot?timeout_segundos=5", token=token, timeout=15
    )
    if status == 200 and content_type.startswith("image/jpeg"):
        SALIDA_JPEG.write_bytes(cuerpo)
        print(f"   OK — {len(cuerpo)} bytes guardados en {SALIDA_JPEG}")
    else:
        print(f"   Snapshot falló ({status}): {_mensaje_seguro(cuerpo, content_type)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
