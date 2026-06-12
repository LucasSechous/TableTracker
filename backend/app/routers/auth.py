# Es el archivo que maneja todo lo relacionado con el login.
# Manejo de contraseñas — cuando un usuario se registra, 
#   la contraseña no se guarda tal cual en la base de datos sino encriptada. 
#   hashear_password la encripta y verificar_password la compara cuando alguien intenta entrar.

#Creación del token — cuando el login es exitoso, el sistema genera un token JWT. 
#   Ese token es básicamente un código que el frontend va a guardar y mandar en cada solicitud para demostrar que el usuario está autenticado. 
#   Tiene una fecha de vencimiento, en este caso 30 minutos.

# El endpoint de login — es la ruta /login a la que el frontend va a llamar mandando email y contraseña. 
#   El sistema busca el usuario en la base de datos, verifica la contraseña, y si todo está bien devuelve el token.


from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserResponse, UserUpdate, Token
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
import os

load_dotenv()

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
http_bearer = HTTPBearer()

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES"))


def verificar_password(password_plano, password_hash):
    return pwd_context.verify(password_plano, password_hash)

def hashear_password(password):
    return pwd_context.hash(password)

def crear_token(data: dict):
    datos = data.copy()
    expiracion = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    datos.update({"exp": expiracion})
    return jwt.encode(datos, SECRET_KEY, algorithm=ALGORITHM)

def get_usuario_actual(credentials: HTTPAuthorizationCredentials = Depends(http_bearer), db: Session = Depends(get_db)):
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credenciales_invalidas
    except JWTError:
        raise credenciales_invalidas
    usuario = db.query(User).filter(User.email == email).first()
    if usuario is None:
        raise credenciales_invalidas
    return usuario


@router.post("/register", response_model=UserResponse, status_code=201)
def register(datos: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == datos.email).first():
        raise HTTPException(status_code=400, detail="El email ya está registrado")
    nuevo_usuario = User(
        nombre=datos.nombre,
        email=datos.email,
        password=hashear_password(datos.password),
        rol=datos.rol,
    )
    db.add(nuevo_usuario)
    db.commit()
    db.refresh(nuevo_usuario)
    return nuevo_usuario


@router.post("/login", response_model=Token)
def login(datos: UserLogin, db: Session = Depends(get_db)):
    usuario = db.query(User).filter(User.email == datos.email).first()
    if not usuario or not verificar_password(datos.password, usuario.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )
    token = crear_token({"sub": usuario.email, "rol": usuario.rol})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def me(usuario: User = Depends(get_usuario_actual)):
    return usuario


@router.put("/users/{id}", response_model=UserResponse)
def modificar_usuario(id: int, datos: UserUpdate, db: Session = Depends(get_db), _: User = Depends(get_usuario_actual)):
    usuario = db.query(User).filter(User.id == id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if datos.email is not None:
        if db.query(User).filter(User.email == datos.email, User.id != id).first():
            raise HTTPException(status_code=400, detail="El email ya está en uso")
        usuario.email = datos.email
    if datos.nombre is not None:
        usuario.nombre = datos.nombre
    if datos.password is not None:
        usuario.password = hashear_password(datos.password)
    if datos.rol is not None:
        usuario.rol = datos.rol
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch("/users/{id}/deactivate", response_model=UserResponse)
def desactivar_usuario(id: int, db: Session = Depends(get_db), _: User = Depends(get_usuario_actual)):
    usuario = db.query(User).filter(User.id == id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    usuario.activo = False
    db.commit()
    db.refresh(usuario)
    return usuario