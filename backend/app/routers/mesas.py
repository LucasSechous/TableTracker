from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import func
from sqlalchemy.exc import IntegrityError
from typing import Optional
from app.database import get_db
from app.models.mesa import Mesa, EstadoMesa
from app.models.sector import Sector
from app.models.historial import HistorialEstado, OrigenCambio
from app.schemas.mesa import MesaCreate, MesaUpdate, MesaResponse, EstadoUpdate, PosicionUpdate
from app.models.user import User
from app.routers.auth import get_usuario_actual, requiere_rol, ROL_ADMIN, ROL_VISION_MODULE

router = APIRouter(dependencies=[Depends(get_usuario_actual)])


def origen_de(usuario: User) -> OrigenCambio:
    """Traduce quién hizo el request a por qué cambió el estado (T26-163).

    Se decide por el rol y no por el email o el id del usuario técnico: ROL_VISION_MODULE
    ya es la marca de "esto lo escribió el módulo de visión" que definió T26-152, y es la
    misma verificación que usan los endpoints de cámaras y ROI para dejarlo pasar. Atarlo
    a una cuenta concreta obligaría a mantener una constante con un email y se rompería
    en silencio el día que se cree un segundo módulo o se renombre el usuario.

    Cualquier otro rol —incluido admin— es una persona operando la aplicación.
    """
    return OrigenCambio.automatico if usuario.rol == ROL_VISION_MODULE else OrigenCambio.manual


def registrar_historial(db: Session, mesa: Mesa, origen: OrigenCambio) -> None:
    """Deja la fila de historial y sincroniza mesa.estado_desde con ella.

    Las dos escrituras van juntas y no en llamadas separadas a propósito: estado_desde
    es una denormalización de la última fila del historial (T26-173), y si se pudieran
    actualizar por separado terminarían discrepando en algún camino que alguien olvidó
    tocar. Acá es imposible cambiar el estado sin mover también el reloj.
    """
    db.add(HistorialEstado(mesa_id=mesa.id, estado=mesa.estado, origen_cambio=origen))
    mesa.estado_desde = func.now()


@router.get("/", response_model=list[MesaResponse])
def listar_mesas(
    sector_id: Optional[int] = Query(None),
    estado: Optional[EstadoMesa] = Query(None),
    incluir_inactivos: bool = Query(False),
    db: Session = Depends(get_db),
):
    query = db.query(Mesa).options(joinedload(Mesa.sector))
    if not incluir_inactivos:
        query = query.filter(Mesa.activa == True)  # noqa: E712
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
def crear_mesa(
    datos: MesaCreate,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol("encargado")),
):
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
def actualizar_mesa(
    mesa_id: int,
    datos: MesaUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol("encargado")),
):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if datos.sector_id is not None and not db.query(Sector).filter(Sector.id == datos.sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")

    # Este PATCH genérico también acepta `estado` (MesaUpdate.estado) y, a diferencia de
    # PATCH /{id}/estado, NUNCA escribió historial. Es una inconsistencia previa a este
    # ticket y arreglarla acá cambiaría el conteo de rotaciones, así que se deja como
    # está; lo que sí se corrige es el reloj, para que una mesa que cambió de estado por
    # esta vía no muestre el tiempo del estado anterior (T26-173).
    cambia_estado = datos.estado is not None and datos.estado != mesa.estado

    for campo, valor in datos.model_dump(exclude_none=True).items():
        setattr(mesa, campo, valor)
    if cambia_estado:
        mesa.estado_desde = func.now()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Ya existe la mesa {datos.numero or mesa.numero} en ese sector")
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{mesa_id}/estado", response_model=MesaResponse)
def cambiar_estado_mesa(
    mesa_id: int,
    datos: EstadoUpdate,
    db: Session = Depends(get_db),
    # ROL_VISION_MODULE (T26-152) cubre lo mismo que ya cubría mozo antes de la
    # promoción temporal a admin en T26-138: este es el único PATCH que el módulo
    # llama sobre mesas.
    usuario: User = Depends(requiere_rol("encargado", "mozo", ROL_VISION_MODULE)),
):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    mesa.estado = datos.estado
    registrar_historial(db, mesa, origen_de(usuario))
    db.commit()
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{mesa_id}/limpieza", response_model=MesaResponse)
def limpiar_mesa(
    mesa_id: int,
    db: Session = Depends(get_db),
    usuario: User = Depends(requiere_rol("encargado", "limpieza")),
):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if mesa.estado != EstadoMesa.pendiente_limpieza:
        raise HTTPException(status_code=409, detail="La mesa no está pendiente de limpieza")
    mesa.estado = EstadoMesa.libre
    registrar_historial(db, mesa, origen_de(usuario))
    db.commit()
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{mesa_id}/reserva", response_model=MesaResponse)
def reservar_mesa(
    mesa_id: int,
    db: Session = Depends(get_db),
    usuario: User = Depends(requiere_rol("encargado", "recepcion")),
):
    mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    mesa.estado = EstadoMesa.reservada
    registrar_historial(db, mesa, origen_de(usuario))
    db.commit()
    db.refresh(mesa)
    db.refresh(mesa, attribute_names=["sector"])
    return mesa


@router.patch("/{id}/posicion", response_model=MesaResponse)
def actualizar_posicion_mesa(
    id: int,
    datos: PosicionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol("encargado")),
):
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
def eliminar_mesa(
    mesa_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol(ROL_ADMIN)),
):
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    db.delete(mesa)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="No se puede eliminar la mesa: tiene historial de estados asociado")
