# CRUD de /camaras/, roles, unicidad y validación (T26-140).
# Cubre la parte de "61 chequeos de API" de T26-126/T26-127, actualizada al
# comportamiento actual del router (T26-136, T26-141, T26-164, T26-165).

from app.models.camara import Camara
from app.routers.camaras import _commit_sin_choque_de_nombre
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
import pytest


RTSP_ALT = "rtsp://otro:clave@10.0.0.9:554/canal2"


# ---------------------------------------------------------------------- listar

def test_listar_vacio(client, como):
    como("admin")
    respuesta = client.get("/camaras/")
    assert respuesta.status_code == 200
    assert respuesta.json() == []


def test_listar_filtra_inactivas_por_defecto(client, como, crear_camara):
    activa = crear_camara(nombre="Activa")
    crear_camara(nombre="Inactiva", activa=False)
    como("admin")

    listado = client.get("/camaras/").json()
    assert [c["id"] for c in listado] == [activa.id]

    listado_completo = client.get("/camaras/", params={"incluir_inactivas": True}).json()
    assert len(listado_completo) == 2


def test_listar_filtra_por_sector(client, como, crear_sector, crear_camara):
    sector_a, sector_b = crear_sector(), crear_sector()
    camara_a = crear_camara(sector_id=sector_a.id, nombre="A")
    crear_camara(sector_id=sector_b.id, nombre="B")
    como("admin")

    listado = client.get("/camaras/", params={"sector_id": sector_a.id}).json()
    assert [c["id"] for c in listado] == [camara_a.id]


def test_listar_no_expone_la_password(client, como, crear_camara):
    crear_camara()
    como("admin")
    camara = client.get("/camaras/").json()[0]
    assert "***" in camara["rtsp_url"] or camara["rtsp_url"].count(":") <= 1
    assert "s3cr3t0" not in camara["rtsp_url"]


# --------------------------------------------------------------------- obtener

def test_obtener_ok(client, como, crear_camara):
    camara = crear_camara()
    como("admin")
    respuesta = client.get(f"/camaras/{camara.id}")
    assert respuesta.status_code == 200
    assert respuesta.json()["id"] == camara.id


def test_obtener_404(client, como):
    como("admin")
    assert client.get("/camaras/9999").status_code == 404


# ----------------------------------------------------------------------- crear

def test_crear_ok(client, como, crear_sector):
    sector = crear_sector()
    como("admin")
    respuesta = client.post(
        "/camaras/",
        json={"nombre": "Cocina", "rtsp_url": "rtsp://user:pass@10.0.0.1:554/s1", "sector_id": sector.id},
    )
    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["nombre"] == "Cocina"
    assert cuerpo["activa"] is True
    assert cuerpo["tiene_credenciales"] is True
    assert "pass" not in cuerpo["rtsp_url"]
    assert cuerpo["sector"]["id"] == sector.id


def test_crear_recorta_espacios_de_sobra_en_el_nombre(client, como, crear_sector):
    como("admin")
    respuesta = client.post(
        "/camaras/",
        json={
            "nombre": "  Cocina  ",
            "rtsp_url": "rtsp://10.0.0.1:554/s1",
            "sector_id": crear_sector().id,
        },
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["nombre"] == "Cocina"


def test_crear_sin_credenciales(client, como, crear_sector):
    sector = crear_sector()
    como("admin")
    respuesta = client.post(
        "/camaras/", json={"nombre": "Barra", "rtsp_url": "rtsp://10.0.0.2:554/s2", "sector_id": sector.id}
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["tiene_credenciales"] is False


def test_crear_sector_inexistente(client, como):
    como("admin")
    respuesta = client.post(
        "/camaras/", json={"nombre": "X", "rtsp_url": "rtsp://10.0.0.1:554/s", "sector_id": 9999}
    )
    assert respuesta.status_code == 400


@pytest.mark.parametrize(
    "rtsp_url",
    [
        "no-es-una-url",
        "http://10.0.0.1/s",  # esquema equivocado
        "rtsp://",  # sin host
        "rtsp://user:***@10.0.0.1:554/s",  # password enmascarada reenviada
    ],
)
def test_crear_rtsp_url_invalida(client, como, crear_sector, rtsp_url):
    como("admin")
    respuesta = client.post(
        "/camaras/", json={"nombre": "X", "rtsp_url": rtsp_url, "sector_id": crear_sector().id}
    )
    assert respuesta.status_code == 422


# "   " (sólo espacios) es la regresión de T26-166: CamaraCreate.validar_nombre()
# hace `.strip()` en un @field_validator en modo "after", que en Pydantic v2
# corre DESPUÉS de que Field(min_length=1) ya validó el string CRUDO — un nombre
# de puros espacios tiene longitud > 0 antes del strip, así que sin el chequeo
# explícito de _validar_nombre_no_vacio() pasaría la validación y terminaría
# guardado como "" en la base.
@pytest.mark.parametrize("nombre", ["", "   ", "x" * 101])
def test_crear_nombre_invalido(client, como, crear_sector, nombre):
    como("admin")
    respuesta = client.post(
        "/camaras/",
        json={"nombre": nombre, "rtsp_url": "rtsp://10.0.0.1:554/s", "sector_id": crear_sector().id},
    )
    assert respuesta.status_code == 422


def test_actualizar_a_nombre_de_solo_espacios_da_422(client, como, crear_camara):
    """Mismo hallazgo que test_crear_nombre_invalido, del lado de CamaraUpdate —
    _validar_nombre_no_vacio() es compartido entre las dos clases."""
    camara = crear_camara()
    como("admin")
    respuesta = client.patch(f"/camaras/{camara.id}", json={"nombre": "   "})
    assert respuesta.status_code == 422


def test_crear_nombre_duplicado(client, como, crear_camara):
    camara = crear_camara(nombre="Cocina")
    como("admin")
    respuesta = client.post(
        "/camaras/",
        json={"nombre": "Cocina", "rtsp_url": "rtsp://10.0.0.5:554/s", "sector_id": camara.sector_id},
    )
    assert respuesta.status_code == 409
    assert "inactiva" in respuesta.json()["detail"]


def test_crear_nombre_de_camara_inactiva_tambien_es_409(client, como, crear_camara):
    inactiva = crear_camara(nombre="Cocina", activa=False)
    como("admin")
    respuesta = client.post(
        "/camaras/",
        json={"nombre": "Cocina", "rtsp_url": "rtsp://10.0.0.5:554/s", "sector_id": inactiva.sector_id},
    )
    assert respuesta.status_code == 409


# ------------------------------------------------------------------ actualizar

def test_actualizar_nombre(client, como, crear_camara):
    camara = crear_camara(nombre="Vieja")
    como("admin")
    respuesta = client.patch(f"/camaras/{camara.id}", json={"nombre": "Nueva"})
    assert respuesta.status_code == 200
    assert respuesta.json()["nombre"] == "Nueva"


def test_actualizar_al_mismo_nombre_no_dispara_409(client, como, crear_camara):
    camara = crear_camara(nombre="Fija")
    como("admin")
    respuesta = client.patch(f"/camaras/{camara.id}", json={"nombre": "Fija"})
    assert respuesta.status_code == 200


def test_actualizar_a_nombre_ocupado(client, como, crear_sector):
    sector = crear_sector()
    como("admin")
    client.post("/camaras/", json={"nombre": "A", "rtsp_url": "rtsp://10.0.0.1:554/s", "sector_id": sector.id})
    b = client.post(
        "/camaras/", json={"nombre": "B", "rtsp_url": "rtsp://10.0.0.2:554/s", "sector_id": sector.id}
    ).json()

    respuesta = client.patch(f"/camaras/{b['id']}", json={"nombre": "A"})
    assert respuesta.status_code == 409


def test_actualizar_sector_inexistente(client, como, crear_camara):
    camara = crear_camara()
    como("admin")
    respuesta = client.patch(f"/camaras/{camara.id}", json={"sector_id": 9999})
    assert respuesta.status_code == 400


def test_actualizar_reemplaza_las_columnas_de_conexion(client, como, crear_camara):
    camara = crear_camara(rtsp_url="rtsp://viejo:clave1@10.0.0.1:554/s1")
    como("admin")
    respuesta = client.patch(f"/camaras/{camara.id}", json={"rtsp_url": RTSP_ALT})
    assert respuesta.status_code == 200
    assert respuesta.json()["rtsp_url"].startswith("rtsp://otro:***@10.0.0.9:554")


def test_actualizar_no_toca_lo_que_no_se_manda(client, como, crear_camara):
    camara = crear_camara(nombre="Estable")
    como("admin")
    respuesta = client.patch(f"/camaras/{camara.id}", json={"activa": False})
    assert respuesta.status_code == 200
    assert respuesta.json()["nombre"] == "Estable"


@pytest.mark.parametrize("campo", ["nombre", "sector_id", "activa", "rtsp_url"])
def test_actualizar_no_admite_nulos_en_campos_no_anulables(client, como, crear_camara, campo):
    camara = crear_camara()
    como("admin")
    respuesta = client.patch(f"/camaras/{camara.id}", json={campo: None})
    assert respuesta.status_code == 422


def test_actualizar_404(client, como):
    como("admin")
    assert client.patch("/camaras/9999", json={"nombre": "X"}).status_code == 404


# ------------------------------------------------------------------- eliminar

def test_eliminar_es_baja_logica(client, como, crear_camara, db):
    camara = crear_camara()
    como("admin")
    respuesta = client.delete(f"/camaras/{camara.id}")
    assert respuesta.status_code == 204

    assert db.query(Camara).filter(Camara.id == camara.id).first() is not None
    assert client.get("/camaras/").json() == []
    assert len(client.get("/camaras/", params={"incluir_inactivas": True}).json()) == 1


def test_eliminar_404(client, como):
    como("admin")
    assert client.delete("/camaras/9999").status_code == 404


# ---------------------------------------------------------------------- roles

@pytest.mark.parametrize("rol", ["mozo", "encargado", "recepcion", "limpieza"])
def test_roles_sin_permiso_dan_403_en_todo(client, como, crear_camara, rol):
    camara = crear_camara()
    como(rol)
    assert client.get("/camaras/").status_code == 403
    assert client.get(f"/camaras/{camara.id}").status_code == 403
    assert client.post("/camaras/", json={}).status_code == 403
    assert client.patch(f"/camaras/{camara.id}", json={}).status_code == 403
    assert client.delete(f"/camaras/{camara.id}").status_code == 403
    assert client.post(f"/camaras/{camara.id}/test-conexion").status_code == 403
    assert client.post("/camaras/test-conexion", json={"rtsp_url": RTSP_ALT}).status_code == 403


def test_sin_autenticar_da_401(client, crear_camara):
    crear_camara()
    assert client.get("/camaras/").status_code == 401


def test_vision_module_solo_llega_al_listado_y_a_deteccion_actual(client, como, crear_camara):
    """T26-164: antes de este ticket vision_module tenía POST/PATCH/DELETE sobre
    todo el router porque el permiso estaba a nivel de APIRouter. Estos dos son
    los únicos endpoints que le corresponden — el resto tiene que seguir dando
    403 aunque el rol exista y esté autenticado."""
    camara = crear_camara()
    como("vision_module")

    assert client.get("/camaras/").status_code == 200
    assert client.get(f"/camaras/{camara.id}").status_code == 403
    assert client.post("/camaras/", json={}).status_code == 403
    assert client.patch(f"/camaras/{camara.id}", json={}).status_code == 403
    assert client.delete(f"/camaras/{camara.id}").status_code == 403
    assert client.get(f"/camaras/{camara.id}/snapshot").status_code == 403

    respuesta = client.post(
        f"/camaras/{camara.id}/deteccion-actual",
        json={
            "frame_timestamp": "2026-01-01T00:00:00Z",
            "source_id": str(camara.id),
            "frame_width": 640,
            "frame_height": 480,
            "model_name": "test",
            "detections": [],
        },
    )
    assert respuesta.status_code == 204


# ---------------------------------------------------------------- deteccion-actual

def test_deteccion_actual_404_si_todavia_no_llego_ninguna(client, como, crear_camara):
    camara = crear_camara()
    como("admin")
    assert client.get(f"/camaras/{camara.id}/deteccion-actual").status_code == 404


def test_deteccion_actual_publica_y_se_puede_leer(client, como, crear_camara):
    camara = crear_camara()
    payload = {
        "frame_timestamp": "2026-01-01T00:00:00Z",
        "source_id": str(camara.id),
        "frame_width": 640,
        "frame_height": 480,
        "model_name": "test",
        "detections": [],
    }
    como("vision_module")
    assert client.post(f"/camaras/{camara.id}/deteccion-actual", json=payload).status_code == 204

    como("admin")
    respuesta = client.get(f"/camaras/{camara.id}/deteccion-actual")
    assert respuesta.status_code == 200
    assert respuesta.json()["model_name"] == "test"


def test_deteccion_actual_404_si_la_camara_no_existe(client, como):
    como("vision_module")
    payload = {
        "frame_timestamp": "2026-01-01T00:00:00Z", "source_id": "9999",
        "frame_width": 1, "frame_height": 1, "model_name": "x", "detections": [],
    }
    assert client.post("/camaras/9999/deteccion-actual", json=payload).status_code == 404


# ------------------------------------------------------------------- snapshot
#
# Sólo las guardas que no dependen de abrir un stream de video de verdad:
# capturar un frame necesita FFmpeg hablando RTSP completo (SETUP/PLAY/RTP), que
# el fake server de test_rtsp.py no ofrece a propósito (ver su docstring). Eso
# queda fuera de esta suite — se sigue verificando a mano, como ya documenta el
# docstring del propio endpoint.

def test_snapshot_404_si_la_camara_esta_inactiva(client, como, crear_camara):
    camara = crear_camara(activa=False)
    como("admin")
    assert client.get(f"/camaras/{camara.id}/snapshot").status_code == 404


def test_snapshot_500_sin_clave_de_cifrado(client, como, crear_camara, monkeypatch):
    from app.services import cifrado

    camara = crear_camara()
    monkeypatch.delenv(cifrado.VARIABLE_CLAVES, raising=False)
    cifrado._reiniciar_cache()
    como("admin")
    try:
        respuesta = client.get(f"/camaras/{camara.id}/snapshot")
        assert respuesta.status_code == 500
    finally:
        cifrado._reiniciar_cache()  # la próxima query de _multifernet vuelve a leer el env real


# ------------------------------------------------------ el respaldo del motor
#
# T26-165: _commit_sin_choque_de_nombre mira si el texto del error nombra la
# constraint UNIQUE. En Postgres el nombre aparece; en SQLite (lo que corre
# esta suite) no — este test es la regresión de ese bug, saltando el chequeo
# previo del router para forzar que el choque lo detecte el motor.

def test_choque_de_nombre_a_nivel_del_motor_da_409_no_500(db, crear_camara):
    ocupado = crear_camara(nombre="Ocupado")
    nueva = Camara(nombre="Ocupado", host="10.0.0.50", sector_id=ocupado.sector_id)

    with pytest.raises(HTTPException) as excinfo:
        with _commit_sin_choque_de_nombre(db, "Ocupado"):
            db.add(nueva)
    assert excinfo.value.status_code == 409


def test_una_fk_rota_no_se_disfraza_de_409(db):
    rota = Camara(nombre="Nombre único", host="10.0.0.51", sector_id=999999)

    with pytest.raises(IntegrityError):
        with _commit_sin_choque_de_nombre(db, "Nombre único"):
            db.add(rota)
