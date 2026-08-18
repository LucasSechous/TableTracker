from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from app.database import get_db
from app.models.configuracion import ConfiguracionGeneral
from app.schemas.configuracion import ConfiguracionResponse, ConfiguracionUpdate
from app.routers.auth import get_usuario_actual, requiere_rol, ROL_ADMIN

router = APIRouter(dependencies=[Depends(get_usuario_actual)])


def _obtener_fila(db: Session) -> ConfiguracionGeneral:
    config = db.query(ConfiguracionGeneral).filter(ConfiguracionGeneral.id == 1).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuración no encontrada")
    return config


@router.get("", response_model=ConfiguracionResponse)
def obtener_configuracion(db: Session = Depends(get_db)):
    return _obtener_fila(db)


@router.patch("", response_model=ConfiguracionResponse, dependencies=[Depends(requiere_rol(ROL_ADMIN))])
def actualizar_configuracion(datos: ConfiguracionUpdate, db: Session = Depends(get_db)):
    config = _obtener_fila(db)
    for campo, valor in datos.model_dump(exclude_none=True).items():
        setattr(config, campo, valor)
    config.updated_at = func.now()
    db.commit()
    db.refresh(config)
    return config
