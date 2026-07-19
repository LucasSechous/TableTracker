from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from typing import Optional
from app.database import get_db
from app.models.mesa import Mesa, EstadoMesa
from app.models.sector import Sector
from app.models.historial import HistorialEstado
from app.schemas.mesa import MesaCreate, MesaUpdate, MesaResponse, EstadoUpdate, PosicionUpdate
from app.routers.auth import get_usuario_actual

router = APIRouter(dependencies=[Depends(get_usuario_actual)])


def registrar_historial(db: Session, mesa_id: int, estado: EstadoMesa) -> None:
    db.add(HistorialEstado(mesa_id=mesa_id, estado=estado))


@router.get("/", response_model=list[MesaResponse])
def listar_mesas(
    sector_id: Optional[int] = Query(None),
    estado: Optional[EstadoMesa] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Mesa).options(joinedload(Mesa.sector))
    if sector_id is not None:
        query = query.filter(Mesa.sector_id == sector_id)
    if estado is not None:
        query = query.filter(Mesa.estado == estado)
    return query.all()


@router.get("/{mesa_id}", response_model=MesaResponse)
def obtener_mesa(mesa_id: int, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return mesa


@router.post("/", response_model=MesaResponse, status_code=status.HTTP_201_CREATED)
def crear_mesa(datos: MesaCreate, db: Session = Depends(get_db)):
    if not db.query(Sector).filter(Sector.id == datos.sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")
    mesa = Mesa(**datos.model_dump())
    db.add(mesa)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Ya existe la mesa {datos.numero} en ese sector")
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{mesa_id}", response_model=MesaResponse)
def actualizar_mesa(mesa_id: int, datos: MesaUpdate, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if datos.sector_id is not None and not db.query(Sector).filter(Sector.id == datos.sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")
    for campo, valor in datos.model_dump(exclude_none=True).items():
        setattr(mesa, campo, valor)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Ya existe la mesa {datos.numero or mesa.numero} en ese sector")
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{mesa_id}/estado", response_model=MesaResponse)
def cambiar_estado_mesa(mesa_id: int, datos: EstadoUpdate, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    mesa.estado = datos.estado
    registrar_historial(db, mesa.id, mesa.estado)
    db.commit()
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{mesa_id}/limpieza", response_model=MesaResponse)
def limpiar_mesa(mesa_id: int, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if mesa.estado != EstadoMesa.pendiente_limpieza:
        raise HTTPException(status_code=409, detail="La mesa no está pendiente de limpieza")
    mesa.estado = EstadoMesa.libre
    registrar_historial(db, mesa.id, mesa.estado)
    db.commit()
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{mesa_id}/reserva", response_model=MesaResponse)
def reservar_mesa(mesa_id: int, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    mesa.estado = EstadoMesa.reservada
    registrar_historial(db, mesa.id, mesa.estado)
    db.commit()
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{id}/posicion", response_model=MesaResponse)
def actualizar_posicion_mesa(id: int, datos: PosicionUpdate, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == id).first()
    if not mesa or not mesa.activa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    mesa.pos_x = datos.pos_x
    mesa.pos_y = datos.pos_y
    db.commit()
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.delete("/{mesa_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_mesa(mesa_id: int, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    db.delete(mesa)
    db.commit()
