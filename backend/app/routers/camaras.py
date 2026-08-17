from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import get_db
from app.models.camara import Camara
from app.models.sector import Sector
from app.schemas.camara import CamaraCreate, CamaraUpdate, CamaraResponse, CamaraTestResponse
from app.routers.auth import requiere_rol, ROL_ADMIN
from app.services import rtsp

# Configuración de cámaras: solo admin en todos los verbos, incluido el GET
# (T26-116, docs/roles-permisos.md). El listado también queda restringido porque
# la respuesta expone la topología de red del local — host, puerto y usuario de
# cada cámara — y eso no es información para cualquier rol autenticado.
router = APIRouter(dependencies=[Depends(requiere_rol(ROL_ADMIN))])


def _obtener(db: Session, camara_id: int) -> Camara:
    camara = db.query(Camara).options(joinedload(Camara.sector)).filter(Camara.id == camara_id).first()
    if not camara:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")
    return camara


def _validar_sector(db: Session, sector_id: Optional[int]) -> None:
    if sector_id is not None and not db.query(Sector).filter(Sector.id == sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")


def _validar_nombre_libre(db: Session, nombre: str, excluir_id: Optional[int] = None) -> None:
    # La base no tiene UNIQUE sobre camaras.nombre (T26-125), así que la unicidad
    # se controla acá. Sin respaldo del motor: dos altas simultáneas con el mismo
    # nombre podrían pasar las dos.
    query = db.query(Camara).filter(Camara.nombre == nombre)
    if excluir_id is not None:
        query = query.filter(Camara.id != excluir_id)
    if query.first():
        raise HTTPException(
            status_code=409, detail=f"Ya existe una cámara con el nombre «{nombre}» (puede estar inactiva)"
        )


def _refrescar(db: Session, camara: Camara) -> Camara:
    db.refresh(camara)
    db.refresh(camara, attribute_names=["sector"])
    return camara


@router.get("/", response_model=list[CamaraResponse])
def listar_camaras(
    sector_id: Optional[int] = Query(None),
    incluir_inactivas: bool = Query(False),
    db: Session = Depends(get_db),
):
    query = db.query(Camara).options(joinedload(Camara.sector))
    if not incluir_inactivas:
        query = query.filter(Camara.activa == True)  # noqa: E712
    if sector_id is not None:
        query = query.filter(Camara.sector_id == sector_id)
    return query.order_by(Camara.id).all()


@router.get("/{camara_id}", response_model=CamaraResponse)
def obtener_camara(camara_id: int, db: Session = Depends(get_db)):
    return _obtener(db, camara_id)


@router.post("/", response_model=CamaraResponse, status_code=status.HTTP_201_CREATED)
def crear_camara(datos: CamaraCreate, db: Session = Depends(get_db)):
    _validar_sector(db, datos.sector_id)
    _validar_nombre_libre(db, datos.nombre)
    camara = Camara(**datos.model_dump())
    db.add(camara)
    db.commit()
    return _refrescar(db, camara)


@router.patch("/{camara_id}", response_model=CamaraResponse)
def actualizar_camara(camara_id: int, datos: CamaraUpdate, db: Session = Depends(get_db)):
    camara = _obtener(db, camara_id)
    # exclude_unset (y no exclude_none como en mesas/sectores) para distinguir
    # "no toques este campo" de un valor mandado a propósito.
    cambios = datos.model_dump(exclude_unset=True)

    if "sector_id" in cambios:
        _validar_sector(db, cambios["sector_id"])
    if "nombre" in cambios:
        _validar_nombre_libre(db, cambios["nombre"], excluir_id=camara.id)

    for campo, valor in cambios.items():
        setattr(camara, campo, valor)
    db.commit()
    return _refrescar(db, camara)


@router.delete("/{camara_id}", status_code=status.HTTP_204_NO_CONTENT)
def desactivar_camara(camara_id: int, db: Session = Depends(get_db)):
    """Baja lógica: la cámara queda inactiva pero la fila no se borra, porque los
    ROI definidos sobre ella la siguen referenciando. Para reactivarla: PATCH con
    activa=true. Los ROI de la cámara NO se desactivan en cascada — quedan como
    estaban para que reactivarla no obligue a redibujarlos."""
    camara = _obtener(db, camara_id)
    camara.activa = False
    db.commit()


@router.post("/{camara_id}/test-conexion", response_model=CamaraTestResponse)
def probar_conexion_camara(
    camara_id: int,
    timeout_segundos: float = Query(rtsp.TIMEOUT_DEFECTO, ge=1, le=15),
    db: Session = Depends(get_db),
):
    """Intenta abrir el stream RTSP de la cámara y devuelve si respondió.

    Siempre contesta 200: que la cámara no conteste no es un error de la API, y
    el diagnóstico viaja en `ok` y `mensaje` para poder mostrarlo tal cual en la
    UI. Ver app/services/rtsp.py para cómo se hace la prueba."""
    camara = _obtener(db, camara_id)
    resultado = rtsp.probar_url(camara.rtsp_url, timeout=timeout_segundos)
    return CamaraTestResponse(
        ok=resultado.ok,
        mensaje=resultado.mensaje,
        codigo_rtsp=resultado.codigo_rtsp,
        latencia_ms=resultado.latencia_ms,
        rtsp_url=camara.rtsp_url_enmascarada,
    )
