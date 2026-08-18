from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import get_db
from app.models.roi_mesa import RoiMesa
from app.models.mesa import Mesa
from app.models.camara import Camara
from app.schemas.roi_mesa import RoiMesaCreate, RoiMesaUpdate, RoiMesaResponse
from app.routers.auth import requiere_rol, ROL_ADMIN

# Definir los ROI es configuración del sistema de visión: solo admin, igual que
# las cámaras (T26-116, docs/roles-permisos.md).
router = APIRouter(dependencies=[Depends(requiere_rol(ROL_ADMIN))])

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


def _buscar_par(db: Session, mesa_id: int, camara_id: int, excluir_id: Optional[int] = None):
    # "Una mesa tiene un solo ROI por cámara" se aplica solo acá: la base no tiene
    # UNIQUE sobre (mesa_id, camara_id) (T26-125). Sin respaldo del motor, dos
    # altas simultáneas del mismo par podrían pasar las dos.
    query = db.query(RoiMesa).filter(RoiMesa.mesa_id == mesa_id, RoiMesa.camara_id == camara_id)
    if excluir_id is not None:
        query = query.filter(RoiMesa.id != excluir_id)
    return query.first()


def _refrescar(db: Session, roi: RoiMesa) -> RoiMesa:
    db.refresh(roi)
    db.refresh(roi, attribute_names=["mesa", "camara"])
    return roi


@router.get("/", response_model=list[RoiMesaResponse])
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


@router.get("/{roi_id}", response_model=RoiMesaResponse)
def obtener_roi(roi_id: int, db: Session = Depends(get_db)):
    return _obtener(db, roi_id)


@router.post("/", response_model=RoiMesaResponse, status_code=status.HTTP_201_CREATED)
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
    db.add(roi)
    db.commit()
    return _refrescar(db, roi)


@router.patch("/{roi_id}", response_model=RoiMesaResponse)
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

    for campo, valor in cambios.items():
        setattr(roi, campo, valor)
    db.commit()
    return _refrescar(db, roi)


@router.delete("/{roi_id}", status_code=status.HTTP_204_NO_CONTENT)
def desactivar_roi(roi_id: int, db: Session = Depends(get_db)):
    """Baja lógica: el ROI queda inactivo y deja de entregarse en el listado, pero
    la fila se conserva para no perder el polígono ya dibujado. Volver a crearlo
    para la misma mesa y cámara lo reactiva (ver crear_roi)."""
    roi = _obtener(db, roi_id)
    roi.activa = False
    db.commit()
