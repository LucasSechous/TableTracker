# CRUD de /roi-mesa/, unicidad del par (mesa_id, camara_id) y baja lógica con
# reutilización (T26-140). Completa la parte de "61 chequeos de API" de
# T26-126/T26-127 que test_camaras.py no cubre.

from app.models.roi_mesa import RoiMesa
from app.routers.roi import _commit_sin_choque_de_par
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
import pytest


POLIGONO = [[0, 0], [10, 0], [10, 10], [0, 10]]


# ---------------------------------------------------------------------- listar

def test_listar_vacio(client, como):
    como("admin")
    assert client.get("/roi-mesa/").json() == []


def test_listar_filtra_inactivos_por_defecto(client, como, crear_roi):
    activo = crear_roi()
    crear_roi(activa=False)
    como("admin")

    assert [r["id"] for r in client.get("/roi-mesa/").json()] == [activo.id]
    assert len(client.get("/roi-mesa/", params={"incluir_inactivos": True}).json()) == 2


def test_listar_filtra_por_mesa_y_camara(client, como, crear_mesa, crear_camara, crear_roi):
    mesa_a, mesa_b = crear_mesa(), crear_mesa()
    camara = crear_camara()
    roi_a = crear_roi(mesa_id=mesa_a.id, camara_id=camara.id)
    crear_roi(mesa_id=mesa_b.id, camara_id=camara.id)
    como("admin")

    filtrado = client.get("/roi-mesa/", params={"mesa_id": mesa_a.id}).json()
    assert [r["id"] for r in filtrado] == [roi_a.id]


def test_listar_incluye_contexto_de_mesa_y_camara(client, como, crear_mesa, crear_camara, crear_roi):
    mesa = crear_mesa(numero=7)
    camara = crear_camara(nombre="Salón")
    crear_roi(mesa_id=mesa.id, camara_id=camara.id)
    como("admin")

    roi = client.get("/roi-mesa/").json()[0]
    assert roi["mesa_numero"] == 7
    assert roi["camara_nombre"] == "Salón"


# --------------------------------------------------------------------- obtener

def test_obtener_ok(client, como, crear_roi):
    roi = crear_roi()
    como("admin")
    assert client.get(f"/roi-mesa/{roi.id}").status_code == 200


def test_obtener_404(client, como):
    como("admin")
    assert client.get("/roi-mesa/9999").status_code == 404


# ----------------------------------------------------------------------- crear

def test_crear_ok(client, como, crear_mesa, crear_camara):
    mesa, camara = crear_mesa(), crear_camara()
    como("admin")
    respuesta = client.post(
        "/roi-mesa/", json={"mesa_id": mesa.id, "camara_id": camara.id, "coordenadas": POLIGONO}
    )
    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["mesa_id"] == mesa.id
    assert cuerpo["camara_id"] == camara.id
    assert cuerpo["coordenadas"] == POLIGONO


def test_crear_mesa_inexistente(client, como, crear_camara):
    como("admin")
    respuesta = client.post(
        "/roi-mesa/", json={"mesa_id": 9999, "camara_id": crear_camara().id, "coordenadas": POLIGONO}
    )
    assert respuesta.status_code == 400


def test_crear_camara_inexistente(client, como, crear_mesa):
    como("admin")
    respuesta = client.post(
        "/roi-mesa/", json={"mesa_id": crear_mesa().id, "camara_id": 9999, "coordenadas": POLIGONO}
    )
    assert respuesta.status_code == 400


@pytest.mark.parametrize(
    "coordenadas",
    [
        [[0, 0], [1, 1]],  # menos de 3 puntos
        [[0, 0], [1, 1], [-1, 5]],  # coordenada negativa
        [[0, 0], [1, 1], [1, 1, 1]],  # punto que no es [x, y]
        [],
    ],
)
def test_crear_coordenadas_invalidas(client, como, crear_mesa, crear_camara, coordenadas):
    como("admin")
    respuesta = client.post(
        "/roi-mesa/",
        json={"mesa_id": crear_mesa().id, "camara_id": crear_camara().id, "coordenadas": coordenadas},
    )
    assert respuesta.status_code == 422


def test_crear_par_ya_activo_da_409_con_el_id_que_estorba(client, como, crear_roi):
    existente = crear_roi()
    como("admin")
    respuesta = client.post(
        "/roi-mesa/",
        json={"mesa_id": existente.mesa_id, "camara_id": existente.camara_id, "coordenadas": POLIGONO},
    )
    assert respuesta.status_code == 409
    assert str(existente.id) in respuesta.json()["detail"]


def test_crear_sobre_un_par_dado_de_baja_lo_reutiliza(client, como, crear_roi, db):
    de_baja = crear_roi(activa=False, coordenadas=[[1, 1], [2, 1], [2, 2]])
    como("admin")

    respuesta = client.post(
        "/roi-mesa/",
        json={"mesa_id": de_baja.mesa_id, "camara_id": de_baja.camara_id, "coordenadas": POLIGONO},
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["id"] == de_baja.id
    assert respuesta.json()["activa"] is True
    assert respuesta.json()["coordenadas"] == POLIGONO
    assert db.query(RoiMesa).count() == 1  # no quedó una fila nueva además de la reactivada


def test_una_mesa_puede_tener_roi_en_varias_camaras(client, como, crear_mesa, crear_camara):
    mesa = crear_mesa()
    camara_a, camara_b = crear_camara(), crear_camara()
    como("admin")

    r1 = client.post("/roi-mesa/", json={"mesa_id": mesa.id, "camara_id": camara_a.id, "coordenadas": POLIGONO})
    r2 = client.post("/roi-mesa/", json={"mesa_id": mesa.id, "camara_id": camara_b.id, "coordenadas": POLIGONO})
    assert r1.status_code == 201
    assert r2.status_code == 201


# ------------------------------------------------------------------ actualizar

def test_actualizar_coordenadas(client, como, crear_roi):
    roi = crear_roi()
    como("admin")
    nuevas = [[5, 5], [15, 5], [15, 15]]
    respuesta = client.patch(f"/roi-mesa/{roi.id}", json={"coordenadas": nuevas})
    assert respuesta.status_code == 200
    assert respuesta.json()["coordenadas"] == nuevas


def test_actualizar_coordenadas_invalidas(client, como, crear_roi):
    roi = crear_roi()
    como("admin")
    respuesta = client.patch(f"/roi-mesa/{roi.id}", json={"coordenadas": [[0, 0], [1, 1]]})
    assert respuesta.status_code == 422


def test_reapuntar_a_un_par_ya_ocupado_da_409(client, como, crear_mesa, crear_camara, crear_roi):
    camara = crear_camara()
    mesa_ocupada = crear_mesa()
    ocupante = crear_roi(mesa_id=mesa_ocupada.id, camara_id=camara.id)
    libre = crear_roi(mesa_id=crear_mesa().id, camara_id=camara.id)
    como("admin")

    respuesta = client.patch(f"/roi-mesa/{libre.id}", json={"mesa_id": mesa_ocupada.id})
    assert respuesta.status_code == 409
    assert str(ocupante.id) in respuesta.json()["detail"]


def test_reapuntar_a_un_par_libre_funciona(client, como, crear_mesa, crear_roi):
    roi = crear_roi()
    otra_mesa = crear_mesa()
    como("admin")

    respuesta = client.patch(f"/roi-mesa/{roi.id}", json={"mesa_id": otra_mesa.id})
    assert respuesta.status_code == 200
    assert respuesta.json()["mesa_id"] == otra_mesa.id


@pytest.mark.parametrize("campo", ["mesa_id", "camara_id", "coordenadas", "activa"])
def test_actualizar_no_admite_nulos(client, como, crear_roi, campo):
    roi = crear_roi()
    como("admin")
    assert client.patch(f"/roi-mesa/{roi.id}", json={campo: None}).status_code == 422


def test_actualizar_404(client, como):
    como("admin")
    assert client.patch("/roi-mesa/9999", json={"activa": True}).status_code == 404


# ------------------------------------------------------------------- eliminar

def test_eliminar_es_baja_logica(client, como, crear_roi, db):
    roi = crear_roi()
    como("admin")
    assert client.delete(f"/roi-mesa/{roi.id}").status_code == 204

    assert db.query(RoiMesa).filter(RoiMesa.id == roi.id).first() is not None
    assert client.get("/roi-mesa/").json() == []


def test_eliminar_404(client, como):
    como("admin")
    assert client.delete("/roi-mesa/9999").status_code == 404


# ---------------------------------------------------------------------- roles

@pytest.mark.parametrize("rol", ["mozo", "encargado", "recepcion", "limpieza"])
def test_roles_sin_permiso_dan_403_en_todo(client, como, crear_roi, rol):
    roi = crear_roi()
    como(rol)
    assert client.get("/roi-mesa/").status_code == 403
    assert client.get(f"/roi-mesa/{roi.id}").status_code == 403
    assert client.post("/roi-mesa/", json={}).status_code == 403
    assert client.patch(f"/roi-mesa/{roi.id}", json={}).status_code == 403
    assert client.delete(f"/roi-mesa/{roi.id}").status_code == 403


def test_sin_autenticar_da_401(client, crear_roi):
    crear_roi()
    assert client.get("/roi-mesa/").status_code == 401


def test_vision_module_solo_llega_al_listado(client, como, crear_roi):
    """T26-164: mismo hallazgo que en camaras.py — antes vision_module tenía
    escritura sobre todo el router. Sólo el GET del listado le corresponde."""
    roi = crear_roi()
    como("vision_module")

    assert client.get("/roi-mesa/").status_code == 200
    assert client.get(f"/roi-mesa/{roi.id}").status_code == 403
    assert client.post("/roi-mesa/", json={}).status_code == 403
    assert client.patch(f"/roi-mesa/{roi.id}", json={}).status_code == 403
    assert client.delete(f"/roi-mesa/{roi.id}").status_code == 403


# ------------------------------------------------------ el respaldo del motor
#
# T26-165, mismo bug que en camaras.py pero sobre el segundo UNIQUE que agregó
# T26-141: en SQLite el texto del error no nombra la constraint.

def test_choque_de_par_a_nivel_del_motor_da_409_no_500(db, crear_roi):
    ocupado = crear_roi()
    otro = RoiMesa(mesa_id=ocupado.mesa_id, camara_id=ocupado.camara_id, coordenadas=[[1, 1], [2, 1], [2, 2]])

    with pytest.raises(HTTPException) as excinfo:
        with _commit_sin_choque_de_par(db):
            db.add(otro)
    assert excinfo.value.status_code == 409


def test_una_fk_rota_no_se_disfraza_de_409(db, crear_mesa):
    rota = RoiMesa(mesa_id=crear_mesa().id, camara_id=999999, coordenadas=POLIGONO)

    with pytest.raises(IntegrityError):
        with _commit_sin_choque_de_par(db):
            db.add(rota)
