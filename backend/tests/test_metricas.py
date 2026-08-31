# GET /metricas/ocupacion (T26-154) y GET /metricas/rotacion (T26-155).

from datetime import datetime, timedelta

from app.models.historial import HistorialEstado
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


# --------------------------------------------------------------- /rotacion

BASE = datetime(2026, 8, 30, 12, 0, 0)


def _historial(db, mesa_id, estado, momento):
    fila = HistorialEstado(mesa_id=mesa_id, estado=estado, created_at=momento)
    db.add(fila)
    db.commit()
    return fila


def test_rotacion_cuenta_transiciones_no_filas_crudas(client, como, db, crear_mesa):
    # libre -> ocupada (rotación) -> ocupada (corrección manual, NO es otra rotación)
    # -> libre -> ocupada (segunda rotación real).
    mesa = crear_mesa(estado=EstadoMesa.libre)
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE)
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE + timedelta(minutes=1))
    _historial(db, mesa.id, EstadoMesa.libre, BASE + timedelta(minutes=30))
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE + timedelta(minutes=31))
    como("admin")

    cuerpo = client.get("/metricas/rotacion").json()
    assert cuerpo == [{"mesa_id": mesa.id, "numero": mesa.numero, "sector_id": mesa.sector_id, "rotaciones": 2}]


def test_rotacion_filtra_por_rango_de_fechas(client, como, db, crear_mesa):
    mesa = crear_mesa()
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE)  # fuera del rango (antes)
    _historial(db, mesa.id, EstadoMesa.libre, BASE + timedelta(hours=1))
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE + timedelta(hours=2))  # dentro del rango
    _historial(db, mesa.id, EstadoMesa.libre, BASE + timedelta(hours=10))
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE + timedelta(hours=11))  # fuera del rango (después)
    como("admin")

    cuerpo = client.get(
        "/metricas/rotacion",
        params={
            "fecha_inicio": (BASE + timedelta(hours=1, minutes=30)).isoformat(),
            "fecha_fin": (BASE + timedelta(hours=5)).isoformat(),
        },
    ).json()
    assert cuerpo[0]["rotaciones"] == 1


def test_rotacion_no_cuenta_si_ya_venia_ocupada_desde_antes_del_rango(client, como, db, crear_mesa):
    # La mesa ya está 'ocupada' antes de fecha_inicio. La primera fila dentro del
    # rango vuelve a marcarla 'ocupada' (ej. una corrección) sin pasar por otro
    # estado antes: no debe contarse como una rotación nueva.
    mesa = crear_mesa()
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE)
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE + timedelta(hours=2))
    como("admin")

    cuerpo = client.get(
        "/metricas/rotacion", params={"fecha_inicio": (BASE + timedelta(hours=1)).isoformat()}
    ).json()
    assert cuerpo[0]["rotaciones"] == 0


def test_rotacion_asume_libre_si_no_hay_historial_previo_a_fecha_inicio(client, como, db, crear_mesa):
    mesa = crear_mesa()
    _historial(db, mesa.id, EstadoMesa.ocupada, BASE + timedelta(hours=2))
    como("admin")

    cuerpo = client.get(
        "/metricas/rotacion", params={"fecha_inicio": (BASE + timedelta(hours=1)).isoformat()}
    ).json()
    assert cuerpo[0]["rotaciones"] == 1


def test_rotacion_incluye_mesas_sin_movimientos_en_cero(client, como, crear_mesa):
    mesa = crear_mesa()
    como("admin")
    cuerpo = client.get("/metricas/rotacion").json()
    assert cuerpo == [{"mesa_id": mesa.id, "numero": mesa.numero, "sector_id": mesa.sector_id, "rotaciones": 0}]


def test_rotacion_ignora_mesas_inactivas(client, como, db, crear_mesa):
    activa = crear_mesa()
    inactiva = crear_mesa(activa=False)
    _historial(db, inactiva.id, EstadoMesa.ocupada, BASE)
    como("admin")

    cuerpo = client.get("/metricas/rotacion").json()
    assert [fila["mesa_id"] for fila in cuerpo] == [activa.id]


def test_rotacion_filtra_por_sector(client, como, db, crear_sector, crear_mesa):
    sector_a, sector_b = crear_sector(), crear_sector()
    mesa_a = crear_mesa(sector_id=sector_a.id)
    mesa_b = crear_mesa(sector_id=sector_b.id)
    _historial(db, mesa_a.id, EstadoMesa.ocupada, BASE)
    _historial(db, mesa_b.id, EstadoMesa.ocupada, BASE)
    como("admin")

    cuerpo = client.get("/metricas/rotacion", params={"sector_id": sector_a.id}).json()
    assert [fila["mesa_id"] for fila in cuerpo] == [mesa_a.id]


def test_rotacion_sector_inexistente_da_400(client, como):
    como("admin")
    assert client.get("/metricas/rotacion", params={"sector_id": 9999}).status_code == 400


def test_rotacion_fecha_inicio_posterior_a_fecha_fin_da_400(client, como):
    como("admin")
    respuesta = client.get(
        "/metricas/rotacion",
        params={"fecha_inicio": BASE.isoformat(), "fecha_fin": (BASE - timedelta(days=1)).isoformat()},
    )
    assert respuesta.status_code == 400
