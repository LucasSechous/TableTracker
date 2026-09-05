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


# ------------------------------------------- /rotacion acotada al horario (T26-171)

# BASE y las fechas de arriba son naive y app/services/horario las trata como UTC.
# Montevideo está en UTC-3, así que para armar una transición "a las 21:00 del reloj
# del local" hay que guardarla a las 00:00 UTC del día siguiente. Este helper evita
# tener que hacer esa cuenta a mano en cada test, que es donde se cuelan los errores.
def _a_las(hora_local, dia=30):
    """El datetime UTC que corresponde a `hora_local` del día `dia` de agosto de 2026.

    Ojo con el día: 21:00 local es 00:00 UTC del día SIGUIENTE, así que el resultado
    puede caer en otra fecha que la pedida. Como la query ordena por created_at, en un
    test con varias filas hay que pasar el día explícito para que el orden cronológico
    real coincida con el orden en que están escritas.
    """
    from datetime import datetime as _dt

    desplazado = hora_local + 3
    return _dt(2026, 8, dia + desplazado // 24, desplazado % 24, 0, 0)


def _configurar_horario(db, apertura, cierre):
    from datetime import time

    from app.models.configuracion import ConfiguracionGeneral

    config = ConfiguracionGeneral(
        id=1,
        hora_apertura=time(apertura, 0) if apertura is not None else None,
        hora_cierre=time(cierre, 0) if cierre is not None else None,
    )
    db.add(config)
    db.commit()
    return config


def _rotaciones_de(client, mesa_id):
    cuerpo = client.get("/metricas/rotacion").json()
    return next(fila["rotaciones"] for fila in cuerpo if fila["mesa_id"] == mesa_id)


def test_rotacion_sin_horario_configurado_cuenta_las_24_horas(client, como, db, crear_mesa):
    """Regresión: sin horario, el número tiene que ser el mismo que antes de T26-171."""
    mesa = crear_mesa(estado=EstadoMesa.libre)
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(4))   # madrugada
    _historial(db, mesa.id, EstadoMesa.libre, _a_las(5))
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(21))  # servicio
    como("admin")

    assert _rotaciones_de(client, mesa.id) == 2


def test_rotacion_descarta_las_transiciones_fuera_del_horario(client, como, db, crear_mesa):
    mesa = crear_mesa(estado=EstadoMesa.libre)
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(4))   # cerrado: no cuenta
    _historial(db, mesa.id, EstadoMesa.libre, _a_las(5))
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(14))  # abierto: cuenta
    _configurar_horario(db, 12, 23)
    como("admin")

    assert _rotaciones_de(client, mesa.id) == 1


def test_rotacion_con_horario_que_cruza_medianoche(client, como, db, crear_mesa):
    """Restaurante que abre 20:00 y cierra 02:00: la franja es el complemento del rango."""
    # Los días van explícitos porque una noche de servicio cruza dos fechas locales, y
    # además 21:00 local ya cae en el día UTC siguiente. Sin esto las filas quedan
    # desordenadas respecto del ORDER BY created_at y el arrastre de estado se evalúa en
    # un orden que no es el de los hechos.
    mesa = crear_mesa(estado=EstadoMesa.libre)
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(21, dia=30))  # cuenta
    _historial(db, mesa.id, EstadoMesa.libre, _a_las(22, dia=30))
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(1, dia=31))   # 01:00, sigue en servicio
    _historial(db, mesa.id, EstadoMesa.libre, _a_las(10, dia=31))
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(15, dia=31))  # cerrado: no cuenta
    _configurar_horario(db, 20, 2)
    como("admin")

    assert _rotaciones_de(client, mesa.id) == 2


def test_una_ocupacion_fuera_de_horario_no_infla_la_siguiente_en_horario(client, como, db, crear_mesa):
    """El arrastre de estado tiene que procesar TAMBIÉN las filas fuera de la franja.

    Si se saltearan, la mesa seguiría figurando como libre después de ocuparse a las 4
    de la mañana, y la fila 'ocupada' de las 14:00 —que no es una rotación, porque la
    mesa ya venía ocupada— se contaría como si lo fuera. Es el error más fácil de
    cometer al implementar el recorte, y no se nota: el número sale plausible.
    """
    mesa = crear_mesa(estado=EstadoMesa.libre)
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(4))   # fuera de horario
    _historial(db, mesa.id, EstadoMesa.ocupada, _a_las(14))  # dentro, pero ya estaba ocupada
    _configurar_horario(db, 12, 23)
    como("admin")

    assert _rotaciones_de(client, mesa.id) == 0
