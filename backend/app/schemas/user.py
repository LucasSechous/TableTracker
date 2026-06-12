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


class UserUpdate(BaseModel):
    nombre: str | None = None
    email: EmailStr | None = None
    password: str | None = None
    rol: str | None = None


class Token(BaseModel):
    access_token: str
    token_type: str
