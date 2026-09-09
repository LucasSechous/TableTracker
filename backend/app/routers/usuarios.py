# Gestión de usuarios desde la aplicación (T26-175): listado y edición de rol/baja
# lógica para un admin. Hasta este ticket la única gestión posible era POST
# /auth/register (alta) — no había forma de ver quién tiene acceso al sistema ni de
# revocárselo sin tocar la base a mano.
#
# Alcance a propósito acotado (ver la tarea): solo GET /usuarios y PATCH
# /usuarios/{id} para rol y activo. Nada de nombre/email/password acá, y nada de
# DELETE — igual que mesas/sectores/cámaras/ROI, la baja es siempre lógica
# (activo=False), nunca borrado físico, porque el usuario puede estar referenciado
# desde historial_estados.origen_cambio y otras partes del sistema.

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.routers.auth import ROL_ADMIN, get_usuario_actual, requiere_rol
from app.schemas.user import UserAdminResponse, UserAdminUpdate

router = APIRouter(dependencies=[Depends(get_usuario_actual)])

# Cuenta de servicio del módulo de visión (T26-152, T26-164). Identificada por email y
# no por rol a propósito: docs/vision-loop.md y docs/camaras-roi.md dejan constancia de
# que esta cuenta existe hoy con rol "mozo" (no "vision_module"), así que protegerla
# por rol no la protegería en el estado real de la base. Si se cae (queda inactiva),
# el módulo de visión deja de poder autenticarse y la detección se detiene por
# completo — por eso el PATCH de abajo la bloquea explícitamente.
VISION_MODULE_EMAIL = "vision-module@tabletracker.com"


def _a_respuesta_admin(usuario: User) -> UserAdminResponse:
    return UserAdminResponse(
        id=usuario.id,
        nombre=usuario.nombre,
        email=usuario.email,
        rol=usuario.rol,
        activo=usuario.activo,
        es_cuenta_servicio=usuario.email == VISION_MODULE_EMAIL,
    )


@router.get("/", response_model=list[UserAdminResponse], dependencies=[Depends(requiere_rol(ROL_ADMIN))])
def listar_usuarios(incluir_inactivos: bool = Query(False), db: Session = Depends(get_db)):
    query = db.query(User)
    if not incluir_inactivos:
        query = query.filter(User.activo == True)  # noqa: E712
    usuarios = query.order_by(User.id).all()
    return [_a_respuesta_admin(u) for u in usuarios]


@router.patch("/{usuario_id}", response_model=UserAdminResponse)
def actualizar_usuario(
    usuario_id: int,
    datos: UserAdminUpdate,
    db: Session = Depends(get_db),
    admin_actual: User = Depends(requiere_rol(ROL_ADMIN)),
):
    usuario = db.query(User).filter(User.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # exclude_unset (patrón de camaras.py): distingue "no tocar este campo" de
    # "lo mandaron a propósito", necesario para que las salvaguardas de abajo miren
    # solo los cambios que el pedido realmente pide hacer.
    cambios = datos.model_dump(exclude_unset=True)

    if usuario.email == VISION_MODULE_EMAIL and cambios.get("activo") is False:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La cuenta de servicio del módulo de visión no se puede desactivar: "
            "si se cae, la detección se detiene por completo.",
        )

    # Un admin queda "sin admin" si lo desactivan o si le cambian el rol a otra cosa.
    admin_pierde_su_rol = usuario.rol == ROL_ADMIN and (
        cambios.get("activo") is False or ("rol" in cambios and cambios["rol"] != ROL_ADMIN)
    )

    # Regla absoluta, independiente de cuántos otros admins queden: nadie se
    # desactiva ni se quita el rol admin a sí mismo, porque si se equivoca no hay
    # forma de deshacerlo desde la interfaz (queda sin sesión y sin poder loguearse).
    if usuario.id == admin_actual.id and admin_pierde_su_rol:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No podés quitarte el rol admin ni desactivarte a vos mismo.",
        )

    if admin_pierde_su_rol:
        quedan_otros_admins_activos = (
            db.query(User)
            .filter(User.rol == ROL_ADMIN, User.activo == True, User.id != usuario.id)  # noqa: E712
            .first()
            is not None
        )
        if not quedan_otros_admins_activos:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se puede dejar el sistema sin ningún administrador activo.",
            )

    for campo, valor in cambios.items():
        setattr(usuario, campo, valor)
    db.commit()
    db.refresh(usuario)
    return _a_respuesta_admin(usuario)
