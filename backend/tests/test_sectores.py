# DELETE /sectores/{id} pasó a baja lógica y POST /sectores/ reactiva una fila
# dada de baja en vez de chocar contra el UNIQUE(nombre) (T26-199, B-4 de la
# auditoría T26-133). La guarda contra mesas asociadas ahora solo mira mesas
# ACTIVAS, para que un sector ya vaciado (a fuerza de baja lógica) se pueda
# desactivar él también.

from app.models.sector import Sector


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
