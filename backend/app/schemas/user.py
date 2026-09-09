from typing import Optional

from pydantic import BaseModel, EmailStr


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
    """PATCH /usuarios/{id}: solo rol y baja lógica (T26-175). Nombre, email y password
    quedan fuera a propósito — no los pidió el ticket y editarlos no es "gestión de
    usuarios" sino tocar la identidad de la cuenta."""

    rol: Optional[str] = None
    activo: Optional[bool] = None


class Token(BaseModel):
    access_token: str
    token_type: str
