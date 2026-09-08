# GET/PATCH /usuarios: gestión de usuarios desde la aplicación (T26-175).
#
# `como()` (conftest.py) siempre devuelve un usuario con id=1 para el que hace el
# pedido — no persiste fila en la base. Por eso los tests de las salvaguardas de
# "uno mismo" le dan id=1 explícito a la fila objetivo cuando quieren simular que el
# admin se apunta a sí mismo, e id != 1 cuando quieren un objetivo distinto: el id es
# lo único que el router compara entre admin_actual y el usuario del path.

from app.models.user import User
from app.routers.auth import hashear_password
from app.routers.usuarios import VISION_MODULE_EMAIL


# ---------------------------------------------------------------------- listar

def test_listar_filtra_inactivos_por_defecto(client, como, crear_usuario):
    activo = crear_usuario(nombre="Activo")
    crear_usuario(nombre="Inactivo", activo=False)
    como("admin")

    listado = client.get("/usuarios/").json()
    assert [u["id"] for u in listado] == [activo.id]

    listado_completo = client.get("/usuarios/", params={"incluir_inactivos": True}).json()
    assert len(listado_completo) == 2


def test_listar_no_expone_la_password(client, como, crear_usuario):
    crear_usuario()
    como("admin")
    usuario = client.get("/usuarios/").json()[0]
    assert "password" not in usuario


def test_listar_marca_la_cuenta_de_vision_module(client, como, crear_usuario):
    # Rol "mozo" a propósito: docs/vision-loop.md deja constancia de que la cuenta
    # real hoy tiene ese rol, no "vision_module" — la marca tiene que depender del
    # email, no del rol.
    crear_usuario(email=VISION_MODULE_EMAIL, rol="mozo")
    crear_usuario(email="otro@test.local")
    como("admin")

    listado = {u["email"]: u for u in client.get("/usuarios/").json()}
    assert listado[VISION_MODULE_EMAIL]["es_cuenta_servicio"] is True
    assert listado["otro@test.local"]["es_cuenta_servicio"] is False


def test_listar_exige_admin(client, como, crear_usuario):
    crear_usuario()
    como("mozo")
    assert client.get("/usuarios/").status_code == 403


def test_listar_sin_autenticar_da_401(client, crear_usuario):
    crear_usuario()
    assert client.get("/usuarios/").status_code == 401


# --------------------------------------------------------------------- actualizar

def test_patch_cambia_rol(client, como, crear_usuario):
    usuario = crear_usuario(id=2, rol="mozo")
    como("admin")

    respuesta = client.patch(f"/usuarios/{usuario.id}", json={"rol": "encargado"})
    assert respuesta.status_code == 200
    assert respuesta.json()["rol"] == "encargado"


def test_patch_desactiva_usuario(client, como, crear_usuario):
    usuario = crear_usuario(id=2, rol="mozo")
    como("admin")

    respuesta = client.patch(f"/usuarios/{usuario.id}", json={"activo": False})
    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is False


def test_patch_no_pisa_campos_no_enviados(client, como, crear_usuario):
    usuario = crear_usuario(id=2, rol="mozo", activo=True)
    como("admin")

    respuesta = client.patch(f"/usuarios/{usuario.id}", json={"rol": "encargado"})
    assert respuesta.json()["activo"] is True


def test_patch_404_si_no_existe(client, como):
    como("admin")
    assert client.patch("/usuarios/9999", json={"activo": False}).status_code == 404


def test_patch_exige_admin(client, como, crear_usuario):
    usuario = crear_usuario(id=2, rol="mozo")
    como("mozo")
    assert client.patch(f"/usuarios/{usuario.id}", json={"activo": False}).status_code == 403


def test_patch_sin_autenticar_da_401(client, crear_usuario):
    usuario = crear_usuario(id=2)
    assert client.patch(f"/usuarios/{usuario.id}", json={"activo": False}).status_code == 401


def test_desactivar_un_usuario_le_bloquea_el_login(client, como, crear_usuario):
    # Dominio real (no ".local"): EmailStr lo rechaza como special-use, y este test
    # sí pasa por /auth/login con validación real, a diferencia del resto de la suite.
    email = "mozo@tabletracker-test.com"
    password = "claveclave1"
    usuario = crear_usuario(id=2, rol="mozo", email=email, password=hashear_password(password))
    como("admin")

    assert client.patch(f"/usuarios/{usuario.id}", json={"activo": False}).status_code == 200

    respuesta = client.post("/auth/login", json={"email": email, "password": password})
    assert respuesta.status_code == 401


# ------------------------------------------------------- salvaguarda: uno mismo

def test_admin_no_puede_desactivarse_a_si_mismo(client, como, crear_usuario):
    crear_usuario(id=1, rol="admin")  # misma id que el usuario que arma como()
    como("admin")

    respuesta = client.patch("/usuarios/1", json={"activo": False})
    assert respuesta.status_code == 409


def test_admin_no_puede_quitarse_el_rol_admin_a_si_mismo(client, como, crear_usuario):
    crear_usuario(id=1, rol="admin")
    como("admin")

    respuesta = client.patch("/usuarios/1", json={"rol": "mozo"})
    assert respuesta.status_code == 409


def test_admin_no_puede_desactivarse_aunque_haya_otros_admins(client, como, crear_usuario):
    # La regla de "uno mismo" es absoluta: no depende de si quedan otros admins.
    crear_usuario(id=1, rol="admin")
    crear_usuario(id=2, rol="admin")
    como("admin")

    assert client.patch("/usuarios/1", json={"activo": False}).status_code == 409


# --------------------------------------------------------- salvaguarda: último admin

def test_no_se_puede_desactivar_al_ultimo_admin_activo(client, como, crear_usuario):
    ultimo_admin = crear_usuario(id=2, rol="admin")
    como("admin")  # actor con id=1, no persiste fila: no cuenta como "otro admin"

    respuesta = client.patch(f"/usuarios/{ultimo_admin.id}", json={"activo": False})
    assert respuesta.status_code == 409


def test_no_se_puede_quitar_el_rol_al_ultimo_admin_activo(client, como, crear_usuario):
    ultimo_admin = crear_usuario(id=2, rol="admin")
    como("admin")

    respuesta = client.patch(f"/usuarios/{ultimo_admin.id}", json={"rol": "mozo"})
    assert respuesta.status_code == 409


def test_se_puede_desactivar_un_admin_si_queda_otro_activo(client, como, crear_usuario):
    objetivo = crear_usuario(id=2, rol="admin")
    crear_usuario(id=3, rol="admin")  # respaldo activo
    como("admin")

    respuesta = client.patch(f"/usuarios/{objetivo.id}", json={"activo": False})
    assert respuesta.status_code == 200


def test_admin_inactivo_no_cuenta_como_respaldo(client, como, crear_usuario):
    objetivo = crear_usuario(id=2, rol="admin")
    crear_usuario(id=3, rol="admin", activo=False)  # ya estaba de baja
    como("admin")

    respuesta = client.patch(f"/usuarios/{objetivo.id}", json={"activo": False})
    assert respuesta.status_code == 409


# --------------------------------------------------- salvaguarda: cuenta de servicio

def test_no_se_puede_desactivar_la_cuenta_de_vision_module(client, como, crear_usuario):
    servicio = crear_usuario(id=2, email=VISION_MODULE_EMAIL, rol="mozo")
    como("admin")

    respuesta = client.patch(f"/usuarios/{servicio.id}", json={"activo": False})
    assert respuesta.status_code == 409


def test_se_puede_cambiar_el_rol_de_vision_module_sin_desactivarla(client, como, crear_usuario):
    # La salvaguarda de la cuenta de servicio es específica a la baja lógica (T26-175):
    # el ticket no pide bloquear la edición de rol, solo evitar que se caiga por accidente.
    servicio = crear_usuario(id=2, email=VISION_MODULE_EMAIL, rol="mozo")
    como("admin")

    respuesta = client.patch(f"/usuarios/{servicio.id}", json={"rol": "vision_module"})
    assert respuesta.status_code == 200
    assert respuesta.json()["rol"] == "vision_module"
