# Infraestructura pytest del backend (T26-140).
#
# Hasta acá el backend no tenía suite versionada: lo que existía eran scripts que
# se corren a mano (scripts/verificar_*.py) y los ~215 chequeos escritos para
# cerrar T26-126/T26-127 y T26-130, que vivían en la sesión de Claude Code que los
# escribió y se perdían al cerrarla. Este archivo arma la base para que un
# conjunto de chequeos quede versionado y se corra con `pytest` desde `backend/`.
#
# Mismo patrón que los scripts existentes: TestClient contra un SQLite temporal
# en archivo (no `:memory:` — un archivo lo pueden usar varios hilos a la vez sin
# configuración especial, y FastAPI corre cada endpoint sync en su propio hilo del
# threadpool; `:memory:` es por conexión y necesitaría StaticPool para
# compartirse). Nunca toca Supabase.

import os
import tempfile
from pathlib import Path

# Tiene que pasar ANTES de importar nada de `app`: `app/database.py` arma el
# engine al importarse, leyendo DATABASE_URL del entorno en ese momento.
_BASE_TEMPORAL = Path(tempfile.mkdtemp(prefix="tabletracker-pytest-")) / "tests.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_BASE_TEMPORAL.as_posix()}"
os.environ.setdefault("SECRET_KEY", "clave-de-prueba-para-pytest")
os.environ.setdefault("ALGORITHM", "HS256")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "30")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.camara import Camara  # noqa: E402
from app.models.mesa import Mesa  # noqa: E402
from app.models.roi_mesa import RoiMesa  # noqa: E402
from app.models.sector import Sector  # noqa: E402
from app.models.user import User  # noqa: E402
from app.routers.auth import get_usuario_actual  # noqa: E402
from app.services import cifrado  # noqa: E402

# SQLite no aplica foreign keys salvo que se lo pida cada conexión — a
# diferencia de Postgres, que las aplica siempre. Sin esto, borrar una fila
# referenciada no fallaría acá y sí en producción: la base de tests mentiría
# sobre una integridad que Supabase sí garantiza.
event.listen(engine, "connect", lambda con, _: con.execute("PRAGMA foreign_keys=ON"))

# Clave fija para toda la sesión: no hace falta rotarla en medio de una corrida,
# y usar siempre la misma evita que un test que la generó de nuevo invalide lo
# que otro test cifró antes (cifrado._cache se invalida cuando cambia el valor
# de la variable, así que una clave estable evita ese trabajo de más).
os.environ["CAMARA_ENCRYPTION_KEYS"] = cifrado.generar_clave()


@pytest.fixture(autouse=True)
def _base_limpia():
    """Esquema fresco antes de cada test: aísla los tests entre sí sin pagar el
    costo de levantar un proceso nuevo. drop_all + create_all también reinicia
    los autoincrement de SQLite, así que los ids son predecibles test a test."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(autouse=True)
def _sin_detecciones_colgadas():
    """`_ultima_deteccion` (app/routers/camaras.py) es un dict en memoria del
    proceso a propósito — no vive en la base (T26-150, docs/privacidad-vision.md
    §3) — así que resetear las tablas no lo toca. Sin este fixture, una cámara
    con id=1 de un test anterior deja su detección puesta, y como los ids se
    reinician en cada test, la cámara con id=1 del test siguiente la «hereda»."""
    from app.routers.camaras import _ultima_deteccion

    _ultima_deteccion.clear()
    yield


@pytest.fixture(autouse=True)
def _sin_overrides_colgados():
    """Limpia dependency_overrides después de cada test.

    Sin esto, un test que se olvida de pisar el rol con `como()` heredaría el
    override que dejó el test anterior — un falso positivo silencioso donde el
    permiso que se está probando en realidad nunca se ejerció."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def db():
    """Sesión aparte de la que usan los endpoints, para armar datos de partida y
    para verificar el estado de la base después de una llamada a la API."""
    sesion = SessionLocal()
    try:
        yield sesion
    finally:
        sesion.close()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def como(client):
    """`como("admin")` hace que las próximas llamadas del `client` respondan como
    ese rol, sin pasar por login real. Es el mismo patrón que ya usan los
    scripts de verificación: se pisa `get_usuario_actual` — del que depende
    `requiere_rol()` — en vez de fabricar un JWT, porque lo que este archivo
    prueba es la autorización de los routers, no el login en sí (eso lo prueba
    `test_auth.py`, que sí pasa por el flujo real)."""

    def _fijar(rol: str, email: str = None):
        usuario = User(id=1, nombre=rol, email=email or f"{rol}@test.local", password="x", rol=rol)
        app.dependency_overrides[get_usuario_actual] = lambda: usuario
        return usuario

    return _fijar


# --------------------------------------------------------------- datos de base
#
# Factories y no fixtures fijas: la mayoría de los tests arman su propio sector
# o cámara con nombres distintos a propósito (para no chocar con la constraint
# UNIQUE de T26-141 entre tests que corren dentro del mismo test), así que cada
# fixture devuelve una función en vez de un valor.

RTSP_URL_DEFECTO = "rtsp://usuario:s3cr3t0@192.0.2.10:554/stream1"


@pytest.fixture
def crear_sector(db):
    contador = {"n": 0}

    def _crear(nombre: str = None, **campos):
        contador["n"] += 1
        sector = Sector(nombre=nombre or f"Sector {contador['n']}", **campos)
        db.add(sector)
        db.commit()
        db.refresh(sector)
        return sector

    return _crear


@pytest.fixture
def crear_mesa(db, crear_sector):
    contador = {"n": 0}

    def _crear(sector_id: int = None, numero: int = None, **campos):
        contador["n"] += 1
        if sector_id is None:
            sector_id = crear_sector().id
        mesa = Mesa(sector_id=sector_id, numero=numero or contador["n"], **campos)
        db.add(mesa)
        db.commit()
        db.refresh(mesa)
        return mesa

    return _crear


@pytest.fixture
def crear_camara(db, crear_sector):
    contador = {"n": 0}

    def _crear(sector_id: int = None, nombre: str = None, rtsp_url: str = RTSP_URL_DEFECTO, **campos):
        contador["n"] += 1
        if sector_id is None:
            sector_id = crear_sector().id
        camara = Camara(
            nombre=nombre or f"Cámara {contador['n']}",
            sector_id=sector_id,
            **Camara.partes_desde_url(rtsp_url),
            **campos,
        )
        db.add(camara)
        db.commit()
        db.refresh(camara)
        return camara

    return _crear


@pytest.fixture
def crear_roi(db, crear_mesa, crear_camara):
    def _crear(mesa_id: int = None, camara_id: int = None, coordenadas: list = None, **campos):
        roi = RoiMesa(
            mesa_id=mesa_id or crear_mesa().id,
            camara_id=camara_id or crear_camara().id,
            coordenadas=coordenadas or [[0, 0], [10, 0], [10, 10]],
            **campos,
        )
        db.add(roi)
        db.commit()
        db.refresh(roi)
        return roi

    return _crear
