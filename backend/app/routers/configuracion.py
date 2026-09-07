from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from app.database import get_db
from app.models.configuracion import ConfiguracionGeneral
from app.schemas.configuracion import ConfiguracionActualizadaResponse, ConfiguracionResponse, ConfiguracionUpdate
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


@router.patch(
    "", response_model=ConfiguracionActualizadaResponse, dependencies=[Depends(requiere_rol(ROL_ADMIN))]
)
def actualizar_configuracion(datos: ConfiguracionUpdate, db: Session = Depends(get_db)):
    config = _obtener_fila(db)
    cambios = datos.model_dump(exclude_none=True)

    # Umbrales de detección (T26-183): cambiarlos en caliente altera la detección en curso
    # sin que nadie lo vea venir, así que se guarda el valor previo antes de pisarlo para
    # devolverlo en la respuesta — la única forma de que quede constancia de qué valía
    # antes, ya que la fila no lleva historial de estos dos campos.
    anteriores = {}
    for campo in ("confirmacion_segundos", "overlap_minimo"):
        if campo in cambios:
            anteriores[f"{campo}_anterior"] = getattr(config, campo)

    for campo, valor in cambios.items():
        setattr(config, campo, valor)
    config.updated_at = func.now()
    db.commit()
    db.refresh(config)

    return ConfiguracionActualizadaResponse.model_validate(config, from_attributes=True).model_copy(
        update=anteriores
    )
