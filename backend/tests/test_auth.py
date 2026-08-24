# Flujo real de login/token (T26-140).
#
# El resto de esta suite prueba autorización pisando get_usuario_actual con el
# fixture `como()` — rápido y es lo que ya usaban los scripts de verificación
# del repo, pero no ejercita el JWT en sí. Este archivo es la contraparte: prueba
# que registrar, loguearse y usar el token real efectivamente autoriza (y que un
# token o contraseña mala efectivamente no), para que confiar en `como()` en
# todos los demás archivos esté respaldado por al menos un camino end-to-end.

from app.database import SessionLocal
from app.models.user import User
from app.routers.auth import hashear_password


def _crear_admin_directo(email="admin@tabletracker-test.com", password="claveadmin1"):
    """Bootstrap sin pasar por /auth/register (que ya exige admin — no hay forma
    de crear el primer usuario por API, a propósito). Va directo a la base, como
    hace el script real de bootstrap del proyecto."""
    db = SessionLocal()
    try:
        admin = User(nombre="Admin", email=email, password=hashear_password(password), rol="admin")
        db.add(admin)
        db.commit()
    finally:
        db.close()
    return email, password


def test_login_y_token_autorizan_un_endpoint_protegido(client, crear_sector):
    email, password = _crear_admin_directo()
    token = client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]

    respuesta = client.get("/camaras/", headers={"Authorization": f"Bearer {token}"})
    assert respuesta.status_code == 200


def test_login_con_password_incorrecta_da_401(client):
    email, _ = _crear_admin_directo()
    respuesta = client.post("/auth/login", json={"email": email, "password": "incorrecta"})
    assert respuesta.status_code == 401


def test_register_exige_admin(client):
    email, password = _crear_admin_directo()
    token = client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]

    respuesta = client.post(
        "/auth/register",
        json={"nombre": "Mozo Nuevo", "email": "mozo@tabletracker-test.com", "password": "clavemozo1", "rol": "mozo"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert respuesta.status_code == 201

    sin_token = client.post(
        "/auth/register",
        json={"nombre": "X", "email": "otro@tabletracker-test.com", "password": "x", "rol": "mozo"},
    )
    assert sin_token.status_code == 401


def test_el_usuario_registrado_puede_loguearse_con_su_rol(client):
    email, password = _crear_admin_directo()
    token_admin = client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]
    client.post(
        "/auth/register",
        json={"nombre": "Mozo", "email": "mozo2@tabletracker-test.com", "password": "clavemozo1", "rol": "mozo"},
        headers={"Authorization": f"Bearer {token_admin}"},
    )

    token_mozo = client.post(
        "/auth/login", json={"email": "mozo2@tabletracker-test.com", "password": "clavemozo1"}
    ).json()["access_token"]

    # El JWT real trae rol mozo: un endpoint admin-only tiene que rechazarlo con 403,
    # no con el 401 que daría un token roto — la diferencia es autenticación vs. autorización.
    respuesta = client.get("/camaras/", headers={"Authorization": f"Bearer {token_mozo}"})
    assert respuesta.status_code == 403


def test_token_invalido_da_401(client):
    respuesta = client.get("/camaras/", headers={"Authorization": "Bearer no-es-un-jwt"})
    assert respuesta.status_code == 401


def test_sin_header_da_401(client):
    assert client.get("/camaras/").status_code == 401
