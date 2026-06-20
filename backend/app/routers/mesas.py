from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.mesa import Mesa
from app.models.sector import Sector
from app.schemas.mesa import MesaCreate, MesaUpdate, MesaResponse

router = APIRouter()


@router.get("/", response_model=list[MesaResponse])
def listar_mesas(db: Session = Depends(get_db)):
    return db.query(Mesa).all()


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
    if datos.sector_id and not db.query(Sector).filter(Sector.id == datos.sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")
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
