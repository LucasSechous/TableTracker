# DELETE /mesas/{id} pasó a baja lógica y POST /mesas/ reactiva una fila dada de
# baja en vez de chocar contra el UNIQUE(numero, sector_id) (T26-199, B-4 de la
# auditoría T26-133). No es CRUD completo de mesas: ese ya lo cubren indirectamente
# test_metricas.py y test_estado_dudoso.py; esto cubre específicamente el cambio.

from app.models.historial import HistorialEstado, OrigenCambio
from app.models.mesa import Mesa


# --------------------------------------------------------------------- eliminar

def test_eliminar_es_baja_logica(client, como, crear_mesa, db):
    mesa = crear_mesa()
    como("admin")

    respuesta = client.delete(f"/mesas/{mesa.id}")

    assert respuesta.status_code == 204
    db.expire_all()
    assert db.query(Mesa).count() == 1  # sigue en la base, no se borró
    assert db.query(Mesa).filter(Mesa.id == mesa.id).first().activa is False


def test_eliminar_no_falla_aunque_tenga_historial(client, como, crear_mesa, db):
    """Antes de T26-199 esto tiraba 409: el borrado físico chocaba con la FK de
    historial_estados. Es justo el caso más común, porque cualquier mesa que
    haya cambiado de estado alguna vez tiene al menos una fila."""
    mesa = crear_mesa()
    db.add(HistorialEstado(mesa_id=mesa.id, estado=mesa.estado, origen_cambio=OrigenCambio.manual))
    db.commit()
    como("admin")

    assert client.delete(f"/mesas/{mesa.id}").status_code == 204


def test_eliminar_desaparece_del_listado_por_defecto(client, como, crear_mesa):
    mesa = crear_mesa()
    como("admin")
    client.delete(f"/mesas/{mesa.id}")

    assert client.get("/mesas/").json() == []
    assert len(client.get("/mesas/", params={"incluir_inactivos": True}).json()) == 1


def test_eliminar_inexistente_da_404(client, como):
    como("admin")
    assert client.delete("/mesas/999").status_code == 404


# ----------------------------------------------------------------------- crear

def test_crear_sobre_una_mesa_dada_de_baja_la_reutiliza(client, como, crear_mesa, crear_sector, db):
    sector = crear_sector()
    de_baja = crear_mesa(sector_id=sector.id, numero=7, activa=False)
    como("encargado")

    respuesta = client.post("/mesas/", json={"numero": 7, "sector_id": sector.id})

    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["id"] == de_baja.id
    assert cuerpo["activa"] is True
    assert cuerpo["estado"] == "libre"
    assert db.query(Mesa).count() == 1  # no quedó una fila nueva además de la reactivada


def test_crear_sobre_una_mesa_activa_da_409(client, como, crear_mesa):
    activa = crear_mesa(numero=7)
    como("encargado")

    respuesta = client.post("/mesas/", json={"numero": 7, "sector_id": activa.sector_id})

    assert respuesta.status_code == 409
    assert str(activa.numero) in respuesta.json()["detail"]
