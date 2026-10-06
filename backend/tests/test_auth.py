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
from app.routers.auth import LOGIN_RATE_LIMIT, hashear_password, verificar_password


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


# ------------------------------------------------------------------ hasheo (RF-03)


def test_hashear_password_no_guarda_el_texto_plano_y_verifica():
    """La contraseña nunca se guarda tal cual, y el hash sirve para verificar.

    Es la única prueba de esta suite que mira hashear_password/verificar_password en
    aislamiento. El resto las ejercita de refilón —todo login pasa por ahí—, pero de
    refilón no se distingue "verifica bien" de "verifica cualquier cosa": un
    verificar_password que devolviera True siempre dejaría pasar igual todos los tests de
    login con la clave correcta. Por eso acá se afirman los dos lados, el positivo y el
    negativo.
    """
    hash_guardado = hashear_password("claveadmin1")

    assert hash_guardado != "claveadmin1"
    # Y no está embebido en ninguna parte del hash: lo importante no es que el string sea
    # distinto, es que la clave no se pueda leer de la columna.
    assert "claveadmin1" not in hash_guardado

    assert verificar_password("claveadmin1", hash_guardado) is True
    assert verificar_password("otra-clave", hash_guardado) is False

    # bcrypt saltea cada hash, así que la misma clave hasheada dos veces da distinto y las
    # dos verifican. Sin sal, dos usuarios con la misma contraseña tendrían la misma fila.
    otro_hash = hashear_password("claveadmin1")
    assert otro_hash != hash_guardado
    assert verificar_password("claveadmin1", otro_hash) is True


# ------------------------------------------------------------------- login y token


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


# --------------------------------------------------------- baja lógica (T26-175)

def test_login_de_usuario_inactivo_da_401(client, db):
    email, password = _crear_admin_directo(email="inactivo@tabletracker-test.com")
    usuario = db.query(User).filter(User.email == email).first()
    usuario.activo = False
    db.commit()

    respuesta = client.post("/auth/login", json={"email": email, "password": password})
    assert respuesta.status_code == 401


def test_desactivar_a_alguien_corta_el_acceso_de_un_token_ya_emitido(client, db):
    """No solo /auth/login rechaza a un inactivo: un token sacado ANTES de la baja
    también deja de servir en el próximo pedido, porque get_usuario_actual revalida
    `activo` en cada request (T26-175) — si no, la baja lógica no revocaría nada
    hasta que ese JWT venciera solo."""
    email, password = _crear_admin_directo(email="a-desactivar@tabletracker-test.com")
    token = client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/auth/me", headers=headers).status_code == 200

    usuario = db.query(User).filter(User.email == email).first()
    usuario.activo = False
    db.commit()

    assert client.get("/auth/me", headers=headers).status_code == 401


# ----------------------------------------------- rate limit de login (RNF Seguridad)


def test_demasiados_logins_fallidos_dan_429(client):
    """Agotar el cupo corta incluso un login con la contraseña correcta.

    Ese último paso es el que importa: un rate limit que solo rechazara intentos
    equivocados no frenaría nada —el atacante sigue probando— así que lo que se verifica
    es que el corte es por ORIGEN y no por resultado. Con la clave buena y el cupo
    agotado, la respuesta tiene que ser 429 y no 200.

    El aislamiento lo garantiza el fixture _sin_intentos_de_login_colgados (conftest):
    este test deja la IP de TestClient con el cupo agotado, y sin ese reset los tests
    posteriores que hacen login recibirían 429.
    """
    email, password = _crear_admin_directo()

    # Los del cupo son todos 401: cuentan como intento fallido pero todavía no cortan.
    for intento in range(LOGIN_RATE_LIMIT):
        respuesta = client.post("/auth/login", json={"email": email, "password": "incorrecta"})
        assert respuesta.status_code == 401, f"el intento {intento + 1} debería ser 401"

    # El siguiente, con la contraseña REAL, ya no llega a validarse.
    respuesta = client.post("/auth/login", json={"email": email, "password": password})
    assert respuesta.status_code == 429
    assert "Demasiados intentos" in respuesta.json()["detail"]
