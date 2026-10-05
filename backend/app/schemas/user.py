from typing import Annotated, Optional

from pydantic import BaseModel, EmailStr, StringConstraints


# Nombre visible de un usuario. `User.nombre` es NOT NULL, así que un "" o un "   " no
# son un nombre más corto: dejan la fila sin nombre y la pantalla de usuarios con una
# tarjeta sin encabezado. strip_whitespace + min_length=1 lo rechaza con 422 desde Pydantic,
# sin que el router tenga que validar nada (RF-03).
NombreUsuario = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class UserCreate(BaseModel):
    nombre: str
    email: EmailStr
    password: str
    rol: str = "mozo"


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    nombre: str
    email: str
    rol: str
    activo: bool

    model_config = {"from_attributes": True}


class UserAdminResponse(UserResponse):
    """Respuesta de GET/PATCH /usuarios/{id}: además de lo público de UserResponse,
    marca si la fila es la cuenta de servicio de vision-module (T26-175), para que la
    pantalla de admin pueda avisar antes de que alguien la desactive por error."""

    es_cuenta_servicio: bool


class UserAdminUpdate(BaseModel):
    """PATCH /usuarios/{id}: nombre, rol y baja lógica (T26-175, RF-03).

    Email y password siguen fuera a propósito, y ahora por un motivo más concreto que
    "no los pidió el ticket":

      - El email es la IDENTIDAD de la cuenta en tres lugares a la vez: es el `sub` del
        JWT (auth.py lo usa para resolver al usuario en cada request, así que cambiarlo
        deja a esa persona sin sesión al instante) y es la clave con la que este router
        reconoce a la cuenta de servicio de vision-module (VISION_MODULE_EMAIL).
        Renombrarla desactivaría esa salvaguarda en silencio.
      - La password no se puede rotar sin decidir qué pasa con los tokens ya emitidos:
        el JWT vive ACCESS_TOKEN_EXPIRE_MINUTES y acá no hay versionado que lo invalide,
        así que un reseteo dejaría la credencial vieja usable hasta que venza sola.

    El nombre no tiene ninguno de esos dos problemas: no identifica nada y no autentica
    nada, es la etiqueta que se muestra. Por eso entra y los otros dos no."""

    nombre: Optional[NombreUsuario] = None
    rol: Optional[str] = None
    activo: Optional[bool] = None


class Token(BaseModel):
    access_token: str
    token_type: str
