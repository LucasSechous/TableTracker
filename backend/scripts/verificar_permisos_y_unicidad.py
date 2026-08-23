# Verificación de T26-164 y T26-165, sobre los routers de cámaras y ROI.
#
# Nació como smoke para probar el merge de T26-141 contra develop, y encontró las
# dos cosas que estos tickets vinieron a arreglar:
#
#   T26-164 — el rol vision_module tenía POST, PATCH y DELETE sobre /camaras/ y
#     /roi-mesa/ porque el permiso estaba en el APIRouter y no por endpoint. Acá se
#     comprueba que ahora solo pasa por los dos endpoints que el módulo usa de
#     verdad, y que los demás le dan 403.
#   T26-165 — la traducción del choque de UNIQUE a 409 solo funcionaba contra
#     Postgres, porque miraba el nombre de la constraint y SQLite no lo nombra. La
#     sección 6 ejercita ese camino salteando el chequeo previo del router, que es
#     la única forma de llegar al motor sin una carrera real.
#
# Sigue la convención de los otros scripts de verificación del repo: TestClient
# contra un SQLite temporal, imprime cada chequeo, termina con código 1 si alguno
# falla. Nunca toca Supabase.
#
# Uso (desde backend/, con el venv activado):
#   python scripts/verificar_permisos_y_unicidad.py

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_BASE = Path(tempfile.mkdtemp(prefix="tabletracker-smoke-")) / "smoke.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_BASE.as_posix()}"
os.environ.setdefault("SECRET_KEY", "clave-de-prueba-smoke")
os.environ.setdefault("ALGORITHM", "HS256")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.camara import Camara  # noqa: E402
from app.models.mesa import Mesa  # noqa: E402
from app.models.roi_mesa import RoiMesa  # noqa: E402
from app.models.sector import Sector  # noqa: E402
from app.models.user import User  # noqa: E402
from app.routers.auth import get_usuario_actual  # noqa: E402
from app.services import cifrado  # noqa: E402

os.environ["CAMARA_ENCRYPTION_KEYS"] = cifrado.generar_clave()

_fallos, _total = [], 0


def check(desc, cond, detalle=""):
    global _total
    _total += 1
    if cond:
        print(f"  ok    {desc}")
    else:
        print(f"  FALLA {desc}" + (f"  -> {detalle}" if detalle else ""))
        _fallos.append(desc)


def seccion(t):
    print(f"\n[{t}]")


def como(rol):
    """Cambia el rol con el que responde la API. requiere_rol() devuelve un closure
    nuevo en cada llamada, así que se sobrescribe get_usuario_actual, del que depende."""
    app.dependency_overrides[get_usuario_actual] = lambda: User(
        id=1, nombre=rol, email=f"{rol}@test.local", password="x", rol=rol
    )


URL = "rtsp://cam:s3cr3t0@192.168.1.50:554/stream1"


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add(Sector(id=1, nombre="Salón"))
    db.flush()
    db.add_all([Mesa(id=1, numero=1, sector_id=1, estado="libre"),
                Mesa(id=2, numero=2, sector_id=1, estado="libre")])
    db.commit()
    c = TestClient(app)

    # ------------------------------------------------- roles (T26-152 x T26-141)
    seccion("1] Roles sobre los routers que toca T26-141")
    como("admin")
    check("admin GET /camaras/ -> 200", c.get("/camaras/").status_code == 200)
    check("admin GET /roi-mesa/ -> 200", c.get("/roi-mesa/").status_code == 200)

    como("vision_module")
    check("vision_module GET /camaras/ -> 200", c.get("/camaras/").status_code == 200)
    check("vision_module GET /roi-mesa/ -> 200", c.get("/roi-mesa/").status_code == 200)

    for rol in ("mozo", "encargado"):
        como(rol)
        r1, r2 = c.get("/camaras/"), c.get("/roi-mesa/")
        check(f"{rol} GET /camaras/ -> 403", r1.status_code == 403, r1.status_code)
        check(f"{rol} GET /roi-mesa/ -> 403", r2.status_code == 403, r2.status_code)

    # El PATCH de estado que el módulo sí necesita sobre mesas
    como("vision_module")
    r = c.patch("/mesas/1/estado", json={"estado": "ocupada"})
    check("vision_module PATCH /mesas/1/estado -> 200", r.status_code == 200, r.status_code)
    como("mozo")
    r = c.patch("/mesas/1/estado", json={"estado": "libre"})
    check("mozo PATCH /mesas/1/estado -> 200 (no lo rompió T26-152)", r.status_code == 200, r.status_code)

    # Alcance real del rol nuevo: solo lo que el módulo usa (T26-164)
    como("admin")
    semilla = c.post("/camaras/", json={"nombre": "Semilla", "rtsp_url": URL, "sector_id": 1}).json()["id"]
    sroi = c.post("/roi-mesa/", json={"mesa_id": 2, "camara_id": semilla,
                                      "coordenadas": [[0, 0], [4, 0], [4, 4]]}).json()["id"]
    como("vision_module")
    escrituras = [
        ("POST /camaras/", c.post("/camaras/", json={"nombre": "P", "rtsp_url": URL, "sector_id": 1})),
        ("PATCH /camaras/{id}", c.patch(f"/camaras/{semilla}", json={"nombre": "P2"})),
        ("DELETE /camaras/{id}", c.delete(f"/camaras/{semilla}")),
        ("POST /roi-mesa/", c.post("/roi-mesa/", json={"mesa_id": 1, "camara_id": semilla,
                                                       "coordenadas": [[0, 0], [4, 0], [4, 4]]})),
        ("PATCH /roi-mesa/{id}", c.patch(f"/roi-mesa/{sroi}", json={"coordenadas": [[1, 1], [3, 1], [3, 3]]})),
        ("DELETE /roi-mesa/{id}", c.delete(f"/roi-mesa/{sroi}")),
        ("GET /camaras/{id}", c.get(f"/camaras/{semilla}")),
        ("GET /camaras/{id}/snapshot", c.get(f"/camaras/{semilla}/snapshot")),
    ]
    for etiqueta, r in escrituras:
        check(f"vision_module {etiqueta} -> 403", r.status_code == 403, f"devolvió {r.status_code}")

    # ...pero lo que el módulo SÍ necesita tiene que seguir andando
    r = c.post(f"/camaras/{semilla}/deteccion-actual",
               json={"camara_id": semilla, "detecciones": [], "capturado_en": "2026-08-23T12:00:00Z"})
    check("vision_module POST /camaras/{id}/deteccion-actual -> 204/422 (no 403)",
          r.status_code != 403, f"devolvió {r.status_code}")
    r = c.get("/roi-mesa/", params={"camara_id": semilla})
    check("vision_module GET /roi-mesa/?camara_id -> 200", r.status_code == 200, r.status_code)

    como("admin")
    c.delete(f"/roi-mesa/{sroi}")
    c.delete(f"/camaras/{semilla}")

    # ------------------------------------------------------------ CRUD cámaras
    seccion("2] CRUD de cámaras")
    como("admin")
    r = c.post("/camaras/", json={"nombre": "Cocina", "rtsp_url": URL, "sector_id": 1})
    check("POST /camaras/ -> 201", r.status_code == 201, r.text[:120])
    cam_id = r.json()["id"] if r.status_code == 201 else None
    check("la respuesta enmascara la contraseña", "***" in r.json().get("rtsp_url", ""), r.text[:120])

    check("GET /camaras/{id} -> 200", c.get(f"/camaras/{cam_id}").status_code == 200)
    r = c.patch(f"/camaras/{cam_id}", json={"nombre": "Cocina renombrada"})
    check("PATCH nombre -> 200", r.status_code == 200, r.text[:120])
    r = c.patch(f"/camaras/{cam_id}", json={"nombre": "Cocina renombrada"})
    check("PATCH al MISMO nombre -> 200 (sin 409 falso)", r.status_code == 200, r.status_code)

    # ------------------------------------------------- unicidad cámaras (T26-141)
    seccion("3] Unicidad de camaras.nombre")
    r = c.post("/camaras/", json={"nombre": "Cocina renombrada", "rtsp_url": URL, "sector_id": 1})
    check("POST con nombre repetido -> 409", r.status_code == 409, r.status_code)

    r2 = c.post("/camaras/", json={"nombre": "Barra", "rtsp_url": URL, "sector_id": 1})
    cam2 = r2.json()["id"]
    check("segunda cámara con otro nombre -> 201", r2.status_code == 201, r2.text[:120])
    r = c.patch(f"/camaras/{cam2}", json={"nombre": "Cocina renombrada"})
    check("PATCH a un nombre ya usado -> 409", r.status_code == 409, r.status_code)

    c.delete(f"/camaras/{cam2}")
    r = c.post("/camaras/", json={"nombre": "Barra", "rtsp_url": URL, "sector_id": 1})
    check("POST con el nombre de una cámara INACTIVA -> 409", r.status_code == 409, r.status_code)
    check("  y el mensaje avisa que puede estar inactiva",
          "inactiva" in r.json().get("detail", ""), r.json().get("detail", "")[:80])

    # ----------------------------------------------------------------- CRUD ROI
    seccion("4] CRUD de ROI y unicidad del par")
    poli = [[0, 0], [10, 0], [10, 10], [0, 10]]
    r = c.post("/roi-mesa/", json={"mesa_id": 1, "camara_id": cam_id, "coordenadas": poli})
    check("POST /roi-mesa/ -> 201", r.status_code == 201, r.text[:150])
    roi_id = r.json()["id"] if r.status_code == 201 else None

    r = c.post("/roi-mesa/", json={"mesa_id": 1, "camara_id": cam_id, "coordenadas": poli})
    check("POST del MISMO par -> 409", r.status_code == 409, r.status_code)

    r = c.post("/roi-mesa/", json={"mesa_id": 2, "camara_id": cam_id, "coordenadas": poli})
    check("otra mesa en la misma cámara -> 201", r.status_code == 201, r.status_code)
    roi2 = r.json()["id"]

    r = c.patch(f"/roi-mesa/{roi2}", json={"mesa_id": 1})
    check("PATCH reapuntando a un par ocupado -> 409", r.status_code == 409, r.status_code)
    r = c.patch(f"/roi-mesa/{roi2}", json={"coordenadas": [[1, 1], [5, 1], [5, 5]]})
    check("PATCH que no cambia el par -> 200", r.status_code == 200, r.text[:120])

    # baja lógica y reutilización
    check("DELETE /roi-mesa/{id} -> 204", c.delete(f"/roi-mesa/{roi_id}").status_code == 204)
    antes = db.query(RoiMesa).count()
    r = c.post("/roi-mesa/", json={"mesa_id": 1, "camara_id": cam_id, "coordenadas": poli})
    check("re-alta del par dado de baja -> 201 (reutiliza, no 409)", r.status_code == 201, r.status_code)
    db.expire_all()
    check("  y no dejó una fila duplicada", db.query(RoiMesa).count() == antes,
          f"{antes} -> {db.query(RoiMesa).count()}")

    # ------------------------------------------------- errores de entrada (400/422/404)
    seccion("5] Errores de entrada: que ninguno se vuelva 500")
    casos = [
        ("POST cámara con sector inexistente -> 400", 400,
         lambda: c.post("/camaras/", json={"nombre": "X1", "rtsp_url": URL, "sector_id": 999})),
        ("POST ROI con mesa inexistente -> 400", 400,
         lambda: c.post("/roi-mesa/", json={"mesa_id": 999, "camara_id": cam_id, "coordenadas": poli})),
        ("POST ROI con cámara inexistente -> 400", 400,
         lambda: c.post("/roi-mesa/", json={"mesa_id": 2, "camara_id": 999, "coordenadas": poli})),
        ("POST cámara con rtsp_url inválida -> 422", 422,
         lambda: c.post("/camaras/", json={"nombre": "X2", "rtsp_url": "no-es-una-url", "sector_id": 1})),
        ("POST ROI con menos de 3 puntos -> 422", 422,
         lambda: c.post("/roi-mesa/", json={"mesa_id": 2, "camara_id": cam_id, "coordenadas": [[0, 0], [1, 1]]})),
        ("POST ROI con coordenada negativa -> 422", 422,
         lambda: c.post("/roi-mesa/", json={"mesa_id": 2, "camara_id": cam_id, "coordenadas": [[-1, 0], [5, 0], [5, 5]]})),
        ("GET cámara inexistente -> 404", 404, lambda: c.get("/camaras/9999")),
        ("GET ROI inexistente -> 404", 404, lambda: c.get("/roi-mesa/9999")),
        ("PATCH cámara inexistente -> 404", 404, lambda: c.patch("/camaras/9999", json={"nombre": "Z"})),
        ("DELETE ROI inexistente -> 404", 404, lambda: c.delete("/roi-mesa/9999")),
    ]
    for desc, esperado, fn in casos:
        r = fn()
        check(desc, r.status_code == esperado, f"devolvió {r.status_code}: {r.text[:110]}")

    # --------------------------------------------- la carrera, a nivel del motor
    seccion("6] El respaldo del motor (saltando el chequeo previo del router)")
    from app.routers.camaras import _commit_sin_choque_de_nombre
    from app.routers.roi import _commit_sin_choque_de_par
    from fastapi import HTTPException

    for etiqueta, ctx, fila in [
        ("camaras.nombre", _commit_sin_choque_de_nombre(db, "Cocina renombrada"),
         Camara(nombre="Cocina renombrada", host="10.0.0.9", sector_id=1)),
        ("roi_mesa(par)", _commit_sin_choque_de_par(db),
         RoiMesa(mesa_id=2, camara_id=cam_id, coordenadas=poli)),
    ]:
        try:
            with ctx:
                db.add(fila)
            check(f"{etiqueta}: el motor rechaza el duplicado", False, "no hubo conflicto")
        except HTTPException as e:
            check(f"{etiqueta}: conflicto traducido a {e.status_code}", e.status_code == 409, e.status_code)
        except IntegrityError as e:
            check(f"{etiqueta}: conflicto traducido a 409", False,
                  f"quedó IntegrityError sin traducir: {str(e.orig)[:70]}")
            db.rollback()

    db.close()
    print(f"\n{'=' * 62}")
    if _fallos:
        print(f"{len(_fallos)} de {_total} chequeos FALLARON:")
        for f in _fallos:
            print(f"  - {f}")
        sys.exit(1)
    print(f"Los {_total} chequeos pasaron.")


if __name__ == "__main__":
    main()
