# DELETE /sectores/{id} pasó a baja lógica y POST /sectores/ reactiva una fila
# dada de baja en vez de chocar contra el UNIQUE(nombre) (T26-199, B-4 de la
# auditoría T26-133). La guarda contra mesas asociadas ahora solo mira mesas
# ACTIVAS, para que un sector ya vaciado (a fuerza de baja lógica) se pueda
# desactivar él también.

import pytest
from fastapi import HTTPException

from app.models.sector import Sector
from app.routers._comun import validar_sector


# ------------------------------------------------- validacion de sector (RF-04)


def test_validar_sector_rechaza_un_sector_inexistente(db, crear_sector):
    """La guarda compartida que usan /mesas y /metricas antes de filtrar por sector.

    Se prueba la función y no un endpoint porque la usan muchos llamadores
    (`routers/_comun.py`) y lo que importa es que los tres casos se comporten distinto:
    un sector real pasa, `None` pasa —"no filtrar" es el caso normal, no un error— y uno
    inexistente corta con 400.

    Es 400 y no 404 a propósito, y el assert lo fija: el recurso pedido (la lista de
    mesas, el reporte) existe; lo que está mal es el parámetro con el que se lo pidió.
    """
    sector = crear_sector()

    # Ninguno de los dos levanta: si lo hicieran, el test falla por la excepción.
    validar_sector(db, sector.id)
    validar_sector(db, None)

    with pytest.raises(HTTPException) as error:
        validar_sector(db, 999)
    assert error.value.status_code == 400
    assert "no existe" in error.value.detail


def test_crear_mesa_en_un_sector_inexistente_da_400(client, como, crear_sector):
    """La misma guarda, ahora a través de la API, que es como la ve el usuario.

    Acompaña al test de arriba en vez de reemplazarlo: aquel prueba la regla, este que
    el endpoint efectivamente la aplica. Un POST que se olvidara de llamar a
    validar_sector haría estallar la FK con un 500 en lugar de explicar qué pasó.
    """
    crear_sector()
    como("encargado")

    respuesta = client.post("/mesas/", json={"numero": 1, "sector_id": 999})

    assert respuesta.status_code == 400
    assert "no existe" in respuesta.json()["detail"]


# --------------------------------------------------------------------- eliminar

def test_eliminar_es_baja_logica(client, como, crear_sector, db):
    sector = crear_sector()
    como("admin")

    respuesta = client.delete(f"/sectores/{sector.id}")

    assert respuesta.status_code == 204
    db.expire_all()
    assert db.query(Sector).count() == 1  # sigue en la base, no se borró
    assert db.query(Sector).filter(Sector.id == sector.id).first().activo is False


def test_eliminar_bloquea_si_tiene_mesas_activas(client, como, crear_sector, crear_mesa):
    sector = crear_sector()
    crear_mesa(sector_id=sector.id)
    como("admin")

    assert client.delete(f"/sectores/{sector.id}").status_code == 409


def test_eliminar_no_bloquea_si_las_mesas_ya_estan_dadas_de_baja(client, como, crear_sector, crear_mesa):
    """Antes de T26-199 esto quedaba bloqueado para siempre: la guarda miraba
    cualquier fila de mesas, activa o no."""
    sector = crear_sector()
    crear_mesa(sector_id=sector.id, activa=False)
    como("admin")

    assert client.delete(f"/sectores/{sector.id}").status_code == 204


def test_eliminar_desaparece_del_listado_por_defecto(client, como, crear_sector):
    sector = crear_sector()
    como("admin")
    client.delete(f"/sectores/{sector.id}")

    assert client.get("/sectores/").json() == []
    assert len(client.get("/sectores/", params={"incluir_inactivos": True}).json()) == 1


# ----------------------------------------------------------------------- crear

def test_crear_sobre_un_sector_dado_de_baja_lo_reutiliza(client, como, crear_sector, db):
    de_baja = crear_sector(nombre="Terraza", activo=False)
    como("encargado")

    respuesta = client.post("/sectores/", json={"nombre": "Terraza", "descripcion": "Reabierta"})

    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["id"] == de_baja.id
    assert cuerpo["activo"] is True
    assert cuerpo["descripcion"] == "Reabierta"
    assert db.query(Sector).count() == 1  # no quedó una fila nueva además de la reactivada


def test_crear_sobre_un_sector_activo_da_400(client, como, crear_sector):
    crear_sector(nombre="Terraza")
    como("encargado")

    respuesta = client.post("/sectores/", json={"nombre": "Terraza"})

    assert respuesta.status_code == 400
