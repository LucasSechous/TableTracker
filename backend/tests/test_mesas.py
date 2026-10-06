# Endpoints de /mesas: baja lógica y reactivación (T26-199), autenticación del router,
# cambio manual de estado (RF-17), confirmación de limpieza (RF-18) y registro de
# historial (RF-20).
#
# Arrancó cubriendo solo el cambio de T26-199 —que DELETE /mesas/{id} pasara a baja
# lógica y que POST /mesas/ reactivara una fila dada de baja en vez de chocar contra el
# UNIQUE(numero, sector_id)—. Después se le sumaron las pruebas de los RF que el archivo
# ya tenía al alcance y que hasta entonces solo estaban cubiertos por e2e: eso dejaba el
# núcleo de la aplicación dependiendo de una suite de 33 minutos contra la base real.

from app.models.historial import HistorialEstado, OrigenCambio
from app.models.mesa import EstadoMesa, Mesa


# ------------------------------------------------- autenticación del router (RF-02)


def test_mesas_y_sectores_sin_autenticar_dan_401(client, crear_mesa):
    """Los dos routers exigen sesión en el APIRouter, no endpoint por endpoint.

    Este test NO llama a `como()` a propósito: es el único de la suite de mesas que
    corre sin override de `get_usuario_actual`, y por eso es el que puede comprobar que
    la dependencia del router existe. Todos los demás la pisan, así que si alguien la
    borrara del `APIRouter` seguirían pasando en verde.

    Se cubren lectura y escritura porque un `dependencies=[...]` en el router aplica a
    los dos, pero un permiso declarado mal —por ejemplo, solo en el GET— se vería igual
    desde un único caso.
    """
    mesa = crear_mesa()

    assert client.get("/mesas/").status_code == 401
    assert client.get("/sectores/").status_code == 401
    assert client.post("/mesas/", json={"numero": 99, "sector_id": mesa.sector_id}).status_code == 401


# ------------------------------------------------ cambio manual de estado (RF-17)


def test_cambio_manual_de_estado(client, como, crear_mesa, db):
    """Un mozo cambia el estado de una mesa y queda guardado.

    Se verifica la respuesta Y la base. Solo con la respuesta, un endpoint que mutara el
    objeto en memoria y se olvidara el commit se vería idéntico.
    """
    mesa = crear_mesa()
    como("mozo")

    respuesta = client.patch(f"/mesas/{mesa.id}/estado", json={"estado": "ocupada"})

    assert respuesta.status_code == 200
    assert respuesta.json()["estado"] == "ocupada"
    db.expire_all()
    assert db.query(Mesa).filter(Mesa.id == mesa.id).first().estado == EstadoMesa.ocupada


# --------------------------------------------- confirmación de limpieza (RF-18)


def test_confirmar_limpieza_libera_la_mesa_y_queda_en_historial(client, como, crear_mesa, db):
    """Confirmar limpieza libera la mesa; confirmarla de nuevo da 409.

    El segundo intento es la parte que importa: sin la guarda de estado, volver a
    apretar el botón —o un doble click— pasaría a 'libre' una mesa que alguien acaba de
    ocupar, y dejaría una fila de historial inventada.
    """
    mesa = crear_mesa(estado=EstadoMesa.pendiente_limpieza)
    como("limpieza")

    primera = client.patch(f"/mesas/{mesa.id}/limpieza")
    assert primera.status_code == 200
    assert primera.json()["estado"] == "libre"

    filas = db.query(HistorialEstado).filter(HistorialEstado.mesa_id == mesa.id).all()
    assert [f.estado for f in filas] == [EstadoMesa.libre]

    segunda = client.patch(f"/mesas/{mesa.id}/limpieza")
    assert segunda.status_code == 409
    # Y el rechazo no dejó rastro: sigue habiendo una sola fila, no dos.
    db.expire_all()
    assert db.query(HistorialEstado).filter(HistorialEstado.mesa_id == mesa.id).count() == 1


# ------------------------------------------------ registro de historial (RF-20)


def test_cada_cambio_de_estado_deja_una_fila_de_historial(client, como, crear_mesa, db):
    """Dos cambios, dos filas, en orden, y las dos marcadas como manuales.

    El `origen_cambio` es lo que después permite medir cuánto acierta la detección y
    cuánto hay que corregir a mano (RF-27 y las métricas se apoyan en eso), así que un
    cambio hecho por una persona tiene que quedar como `manual`. Lo decide el ROL del
    usuario: cualquiera que no sea vision_module es una persona operando la aplicación.
    """
    mesa = crear_mesa()
    como("mozo")

    assert client.patch(f"/mesas/{mesa.id}/estado", json={"estado": "ocupada"}).status_code == 200
    assert client.patch(f"/mesas/{mesa.id}/estado", json={"estado": "pendiente_limpieza"}).status_code == 200

    filas = (
        db.query(HistorialEstado)
        .filter(HistorialEstado.mesa_id == mesa.id)
        .order_by(HistorialEstado.id)
        .all()
    )
    assert [f.estado for f in filas] == [EstadoMesa.ocupada, EstadoMesa.pendiente_limpieza]
    assert [f.origen_cambio for f in filas] == [OrigenCambio.manual, OrigenCambio.manual]


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
