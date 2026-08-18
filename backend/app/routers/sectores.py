from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.sector import Sector
from app.models.mesa import Mesa
from app.schemas.sector import SectorCreate, SectorUpdate, SectorResponse
from app.models.user import User
from app.routers.auth import get_usuario_actual, requiere_rol, ROL_ADMIN

router = APIRouter(dependencies=[Depends(get_usuario_actual)])


@router.get("/", response_model=list[SectorResponse])
def listar_sectores(incluir_inactivos: bool = Query(False), db: Session = Depends(get_db)):
    query = db.query(Sector)
    if not incluir_inactivos:
        query = query.filter(Sector.activo == True)  # noqa: E712
    return query.all()


@router.get("/{sector_id}", response_model=SectorResponse)
def obtener_sector(sector_id: int, db: Session = Depends(get_db)):
    sector = db.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector no encontrado")
    return sector


@router.post("/", response_model=SectorResponse, status_code=status.HTTP_201_CREATED)
def crear_sector(
    datos: SectorCreate,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol("encargado")),
):
    if db.query(Sector).filter(Sector.nombre == datos.nombre).first():
        raise HTTPException(status_code=400, detail="Ya existe un sector con ese nombre")
    sector = Sector(**datos.model_dump())
    db.add(sector)
    db.commit()
    db.refresh(sector)
    return sector


@router.patch("/{sector_id}", response_model=SectorResponse)
def actualizar_sector(
    sector_id: int,
    datos: SectorUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol("encargado")),
):
    sector = db.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector no encontrado")
    for campo, valor in datos.model_dump(exclude_none=True).items():
        setattr(sector, campo, valor)
    db.commit()
    db.refresh(sector)
    return sector


@router.delete("/{sector_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_sector(
    sector_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol(ROL_ADMIN)),
):
    sector = db.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector no encontrado")
    if db.query(Mesa).filter(Mesa.sector_id == sector_id).first():
        raise HTTPException(status_code=409, detail="No se puede eliminar un sector con mesas asociadas")
    db.delete(sector)
    db.commit()
