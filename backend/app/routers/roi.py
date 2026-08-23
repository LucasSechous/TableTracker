from contextlib import contextmanager
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import es_violacion_unique, get_db
from app.models.roi_mesa import RoiMesa
from app.models.mesa import Mesa
from app.models.camara import Camara
from app.schemas.roi_mesa import RoiMesaCreate, RoiMesaUpdate, RoiMesaResponse
from app.routers.auth import get_usuario_actual, requiere_rol, ROL_ADMIN, ROL_VISION_MODULE

# Definir los ROI es configuración del sistema de visión: admin, igual que las
# cámaras (T26-116, docs/roles-permisos.md).
#
# El permiso va por endpoint y no en el APIRouter (T26-164, igual que camaras.py):
# vision_module solo necesita leer el listado, y ponerlo en el router le daba también
# POST, PATCH y DELETE sobre los ROI. Al agregar un endpoint nuevo acordate del
# `dependencies=`, o queda abierto a cualquier usuario autenticado.
router = APIRouter(dependencies=[Depends(get_usuario_actual)])

SOLO_ADMIN = [Depends(requiere_rol(ROL_ADMIN))]

# El módulo lee este listado al arrancar, filtrado por cámara, para saber qué
# polígono corresponde a cada mesa. Es lo único que consume de este router.
ADMIN_O_VISION = [Depends(requiere_rol(ROL_ADMIN, ROL_VISION_MODULE))]

_CARGA_CONTEXTO = (joinedload(RoiMesa.mesa), joinedload(RoiMesa.camara))


def _obtener(db: Session, roi_id: int) -> RoiMesa:
    roi = db.query(RoiMesa).options(*_CARGA_CONTEXTO).filter(RoiMesa.id == roi_id).first()
    if not roi:
        raise HTTPException(status_code=404, detail="ROI no encontrado")
    return roi


def _validar_referencias(db: Session, mesa_id: Optional[int], camara_id: Optional[int]) -> None:
    if mesa_id is not None and not db.query(Mesa).filter(Mesa.id == mesa_id).first():
        raise HTTPException(status_code=400, detail="La mesa indicada no existe")
    if camara_id is not None and not db.query(Camara).filter(Camara.id == camara_id).first():
        raise HTTPException(status_code=400, detail="La cámara indicada no existe")


# Nombre de la constraint en la base, fijado por la revisión 6597e37ddeab.
_UNIQUE_PAR = "roi_mesa_mesa_camara_unique"


def _buscar_par(db: Session, mesa_id: int, camara_id: int, excluir_id: Optional[int] = None):
    # "Una mesa tiene un solo ROI por cámara". Buscar el par acá es lo que permite
    # reutilizar un ROI dado de baja y dar mensajes con el id del que estorba; que
    # la regla se cumpla siempre lo garantiza el UNIQUE de la base (T26-141), que
    # cierra la ventana entre esta consulta y el commit. Ver _commit_sin_choque_de_par.
    # No filtra por `activa` a propósito: el UNIQUE tampoco distingue, y un ROI
    # inactivo sigue ocupando el par.
    query = db.query(RoiMesa).filter(RoiMesa.mesa_id == mesa_id, RoiMesa.camara_id == camara_id)
    if excluir_id is not None:
        query = query.filter(RoiMesa.id != excluir_id)
    return query.first()


@contextmanager
def _commit_sin_choque_de_par(db: Session):
    """Commitea traduciendo el choque contra roi_mesa_mesa_camara_unique a un 409.

    El mensaje es más pelado que el de _buscar_par —no puede nombrar el id del ROI
    que estorba, porque la fila que lo causó se insertó en otra transacción— pero
    el estado sigue siendo el mismo que ve quien llama: ese par ya está tomado.

    Se mira exactamente qué constraint falló y no cualquier IntegrityError porque
    `roi_mesa` también tiene las FK a `mesas` y `camaras` (ver es_violacion_unique).
    """
    try:
        yield
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if not es_violacion_unique(error, _UNIQUE_PAR, "mesa_id", "camara_id"):
            raise
        raise HTTPException(
            status_code=409,
            detail="Esa mesa ya tiene un ROI definido en esa cámara",
        ) from error


def _refrescar(db: Session, roi: RoiMesa) -> RoiMesa:
    db.refresh(roi)
    db.refresh(roi, attribute_names=["mesa", "camara"])
    return roi


@router.get("/", response_model=list[RoiMesaResponse], dependencies=ADMIN_O_VISION)
def listar_rois(
    mesa_id: Optional[int] = Query(None),
    camara_id: Optional[int] = Query(None),
    incluir_inactivos: bool = Query(False),
    db: Session = Depends(get_db),
):
    query = db.query(RoiMesa).options(*_CARGA_CONTEXTO)
    if not incluir_inactivos:
        query = query.filter(RoiMesa.activa == True)  # noqa: E712
    if mesa_id is not None:
        query = query.filter(RoiMesa.mesa_id == mesa_id)
    if camara_id is not None:
        query = query.filter(RoiMesa.camara_id == camara_id)
    return query.order_by(RoiMesa.id).all()


@router.get("/{roi_id}", response_model=RoiMesaResponse, dependencies=SOLO_ADMIN)
def obtener_roi(roi_id: int, db: Session = Depends(get_db)):
    return _obtener(db, roi_id)


@router.post("/", response_model=RoiMesaResponse, status_code=status.HTTP_201_CREATED, dependencies=SOLO_ADMIN)
def crear_roi(datos: RoiMesaCreate, db: Session = Depends(get_db)):
    _validar_referencias(db, datos.mesa_id, datos.camara_id)

    existente = _buscar_par(db, datos.mesa_id, datos.camara_id)
    if existente and existente.activa:
        raise HTTPException(
            status_code=409,
            detail=f"Esa mesa ya tiene un ROI definido en esa cámara (id {existente.id}): editalo en vez de crear otro",
        )
    if existente:
        # La baja es lógica, así que la fila de ese par sigue existiendo: volver a
        # darlo de alta la reusa en vez de dejar dos filas para la misma mesa y cámara.
        existente.coordenadas = datos.coordenadas
        existente.activa = True
        db.commit()
        return _refrescar(db, existente)

    roi = RoiMesa(**datos.model_dump())
    with _commit_sin_choque_de_par(db):
        db.add(roi)
    return _refrescar(db, roi)


@router.patch("/{roi_id}", response_model=RoiMesaResponse, dependencies=SOLO_ADMIN)
def actualizar_roi(roi_id: int, datos: RoiMesaUpdate, db: Session = Depends(get_db)):
    roi = _obtener(db, roi_id)
    cambios = datos.model_dump(exclude_unset=True)
    _validar_referencias(db, cambios.get("mesa_id"), cambios.get("camara_id"))

    # Reapuntar el ROI a otra mesa o cámara puede chocar con un ROI ya existente
    # para ese par, así que se controla antes de tocar la fila.
    mesa_id = cambios.get("mesa_id", roi.mesa_id)
    camara_id = cambios.get("camara_id", roi.camara_id)
    if (mesa_id, camara_id) != (roi.mesa_id, roi.camara_id):
        choque = _buscar_par(db, mesa_id, camara_id, excluir_id=roi.id)
        if choque:
            raise HTTPException(
                status_code=409,
                detail=f"Ya hay un ROI para esa mesa en esa cámara (id {choque.id})",
            )

    with _commit_sin_choque_de_par(db):
        for campo, valor in cambios.items():
            setattr(roi, campo, valor)
    return _refrescar(db, roi)


@router.delete("/{roi_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=SOLO_ADMIN)
def desactivar_roi(roi_id: int, db: Session = Depends(get_db)):
    """Baja lógica: el ROI queda inactivo y deja de entregarse en el listado, pero
    la fila se conserva para no perder el polígono ya dibujado. Volver a crearlo
    para la misma mesa y cámara lo reactiva (ver crear_roi)."""
    roi = _obtener(db, roi_id)
    roi.activa = False
    db.commit()
