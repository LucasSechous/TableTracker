from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.sector import Sector
from app.schemas.sector import SectorCreate, SectorUpdate, SectorResponse
from app.routers.auth import get_usuario_actual

router = APIRouter(dependencies=[Depends(get_usuario_actual)])


@router.get("/", response_model=list[SectorResponse])
def listar_sectores(db: Session = Depends(get_db)):
    return db.query(Sector).all()


@router.get("/{sector_id}", response_model=SectorResponse)
def obtener_sector(sector_id: int, db: Session = Depends(get_db)):
    sector = db.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector no encontrado")
    return sector


@router.post("/", response_model=SectorResponse, status_code=status.HTTP_201_CREATED)
def crear_sector(datos: SectorCreate, db: Session = Depends(get_db)):
    if db.query(Sector).filter(Sector.nombre == datos.nombre).first():
        raise HTTPException(status_code=400, detail="Ya existe un sector con ese nombre")
    sector = Sector(**datos.model_dump())
    db.add(sector)
    db.commit()
    db.refresh(sector)
    return sector


@router.patch("/{sector_id}", response_model=SectorResponse)
def actualizar_sector(sector_id: int, datos: SectorUpdate, db: Session = Depends(get_db)):
    sector = db.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector no encontrado")
    for campo, valor in datos.model_dump(exclude_none=True).items():
        setattr(sector, campo, valor)
    db.commit()
    db.refresh(sector)
    return sector


@router.delete("/{sector_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_sector(sector_id: int, db: Session = Depends(get_db)):
    sector = db.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector no encontrado")
    db.delete(sector)
    db.commit()
