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
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os

load_dotenv()

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES"))

def verificar_password(password_plano, password_hash):
    return pwd_context.verify(password_plano, password_hash)

def hashear_password(password):
    return pwd_context.hash(password)

def crear_token(data: dict):
    datos = data.copy()
    expiracion = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    datos.update({"exp": expiracion})
    return jwt.encode(datos, SECRET_KEY, algorithm=ALGORITHM)

@router.post("/login")
def login(email: str, password: str, db: Session = Depends(get_db)):
    usuario = db.query(User).filter(User.email == email).first()
    if not usuario or not verificar_password(password, usuario.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas"
        )
    token = crear_token({"sub": usuario.email, "rol": usuario.rol})
    return {"access_token": token, "token_type": "bearer"}