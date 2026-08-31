# GET /metricas/ocupacion: % de ocupación y conteo de mesas por estado (T26-154).

from app.models.mesa import EstadoMesa


def test_ocupacion_sin_mesas(client, como):
    como("admin")
    respuesta = client.get("/metricas/ocupacion")
    assert respuesta.status_code == 200
    assert respuesta.json() == {
        "total_mesas": 0,
        "porcentaje_ocupacion": 0.0,
        "conteo_por_estado": {"libre": 0, "ocupada": 0, "pendiente_limpieza": 0, "reservada": 0},
    }


def test_ocupacion_cuenta_por_estado(client, como, crear_mesa):
    crear_mesa(estado=EstadoMesa.libre)
    crear_mesa(estado=EstadoMesa.libre)
    crear_mesa(estado=EstadoMesa.ocupada)
    crear_mesa(estado=EstadoMesa.pendiente_limpieza)
    crear_mesa(estado=EstadoMesa.reservada)
    como("admin")

    cuerpo = client.get("/metricas/ocupacion").json()
    assert cuerpo["total_mesas"] == 5
    assert cuerpo["conteo_por_estado"] == {
        "libre": 2,
        "ocupada": 1,
        "pendiente_limpieza": 1,
        "reservada": 1,
    }


def test_ocupacion_reservada_no_cuenta_para_el_porcentaje(client, como, crear_mesa):
    # Decisión documentada en app/routers/metricas.py: "reservada" es un bucket aparte,
    # no ocupación física. Con 1 ocupada + 1 reservada + 2 libres, el % debe reflejar
    # solo la ocupada (1/4 = 25%), no la ocupada+reservada (2/4 = 50%).
    crear_mesa(estado=EstadoMesa.ocupada)
    crear_mesa(estado=EstadoMesa.reservada)
    crear_mesa(estado=EstadoMesa.libre)
    crear_mesa(estado=EstadoMesa.libre)
    como("admin")

    cuerpo = client.get("/metricas/ocupacion").json()
    assert cuerpo["porcentaje_ocupacion"] == 25.0


def test_ocupacion_ignora_mesas_inactivas(client, como, crear_mesa):
    crear_mesa(estado=EstadoMesa.ocupada)
    crear_mesa(estado=EstadoMesa.ocupada, activa=False)
    como("admin")

    cuerpo = client.get("/metricas/ocupacion").json()
    assert cuerpo["total_mesas"] == 1
    assert cuerpo["conteo_por_estado"]["ocupada"] == 1


def test_ocupacion_filtra_por_sector(client, como, crear_sector, crear_mesa):
    sector_a, sector_b = crear_sector(), crear_sector()
    crear_mesa(sector_id=sector_a.id, estado=EstadoMesa.ocupada)
    crear_mesa(sector_id=sector_a.id, estado=EstadoMesa.libre)
    crear_mesa(sector_id=sector_b.id, estado=EstadoMesa.reservada)
    como("admin")

    cuerpo = client.get("/metricas/ocupacion", params={"sector_id": sector_a.id}).json()
    assert cuerpo["total_mesas"] == 2
    assert cuerpo["conteo_por_estado"] == {"libre": 1, "ocupada": 1, "pendiente_limpieza": 0, "reservada": 0}


def test_ocupacion_sector_inexistente_da_400(client, como):
    como("admin")
    respuesta = client.get("/metricas/ocupacion", params={"sector_id": 9999})
    assert respuesta.status_code == 400


def test_ocupacion_cualquier_rol_autenticado_puede_leer(client, como, crear_mesa):
    crear_mesa(estado=EstadoMesa.libre)
    como("mozo")
    assert client.get("/metricas/ocupacion").status_code == 200


def test_sin_autenticar_da_401(client, crear_mesa):
    crear_mesa()
    assert client.get("/metricas/ocupacion").status_code == 401
