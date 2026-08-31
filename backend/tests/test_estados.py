# GET /estados: listado de solo lectura de los estados de mesa (T26-157).


def test_listar_estados(client, como):
    como("mozo")
    respuesta = client.get("/estados/")
    assert respuesta.status_code == 200
    assert respuesta.json() == [
        {"valor": "libre", "etiqueta": "Libre"},
        {"valor": "ocupada", "etiqueta": "Ocupada"},
        {"valor": "pendiente_limpieza", "etiqueta": "Pendiente de limpieza"},
        {"valor": "reservada", "etiqueta": "Reservada"},
    ]


def test_sin_autenticar_da_401(client):
    assert client.get("/estados/").status_code == 401
