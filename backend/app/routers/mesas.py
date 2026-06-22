# Router FastAPI para el CRUD de mesas.
# Incluye filtros por sector_id y estado, y validación de unicidad número+sector.

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models.mesa import Mesa, EstadoMesa
from app.models.sector import Sector
from app.schemas.mesa import MesaCreate, MesaUpdate, MesaResponse

router = APIRouter()


@router.get("/", response_model=list[MesaResponse])
def listar_mesas(
    sector_id: Optional[int] = Query(None),
    estado: Optional[EstadoMesa] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Mesa)
    if sector_id is not None:
        query = query.filter(Mesa.sector_id == sector_id)
    if estado is not None:
        query = query.filter(Mesa.estado == estado)
    return query.all()


@router.get("/{mesa_id}", response_model=MesaResponse)
def obtener_mesa(mesa_id: int, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return mesa


@router.post("/", response_model=MesaResponse, status_code=status.HTTP_201_CREATED)
def crear_mesa(datos: MesaCreate, db: Session = Depends(get_db)):
    if not db.query(Sector).filter(Sector.id == datos.sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")
    if db.query(Mesa).filter(Mesa.numero == datos.numero, Mesa.sector_id == datos.sector_id).first():
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe la mesa {datos.numero} en ese sector",
        )
    mesa = Mesa(**datos.model_dump())
    db.add(mesa)
    db.commit()
    db.refresh(mesa)
    return mesa


@router.patch("/{mesa_id}", response_model=MesaResponse)
def actualizar_mesa(mesa_id: int, datos: MesaUpdate, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if datos.sector_id is not None and not db.query(Sector).filter(Sector.id == datos.sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")
    if datos.numero is not None or datos.sector_id is not None:
        nuevo_numero = datos.numero if datos.numero is not None else mesa.numero
        nuevo_sector = datos.sector_id if datos.sector_id is not None else mesa.sector_id
        if db.query(Mesa).filter(
            Mesa.numero == nuevo_numero,
            Mesa.sector_id == nuevo_sector,
            Mesa.id != mesa_id,
        ).first():
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe la mesa {nuevo_numero} en ese sector",
            )
    for campo, valor in datos.model_dump(exclude_none=True).items():
        setattr(mesa, campo, valor)
    db.commit()
    db.refresh(mesa)
    return mesa


@router.delete("/{mesa_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_mesa(mesa_id: int, db: Session = Depends(get_db)):
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    db.delete(mesa)
    db.commit()
