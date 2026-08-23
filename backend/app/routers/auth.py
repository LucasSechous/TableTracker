# Es el archivo que maneja todo lo relacionado con el login.
# Manejo de contraseñas — cuando un usuario se registra, 
#   la contraseña no se guarda tal cual en la base de datos sino encriptada. 
#   hashear_password la encripta y verificar_password la compara cuando alguien intenta entrar.

#Creación del token — cuando el login es exitoso, el sistema genera un token JWT. 
#   Ese token es básicamente un código que el frontend va a guardar y mandar en cada solicitud para demostrar que el usuario está autenticado. 
#   Tiene una fecha de vencimiento, en este caso 30 minutos.

# El endpoint de login — es la ruta /login a la que el frontend va a llamar mandando email y contraseña. 
#   El sistema busca el usuario en la base de datos, verifica la contraseña, y si todo está bien devuelve el token.


from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserResponse, Token
import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
import time
import threading
from collections import defaultdict

load_dotenv()

router = APIRouter()
# HTTPBearer, no OAuth2PasswordBearer: nunca implementamos el flujo OAuth2 real (/auth/login
# espera JSON, no el form-urlencoded que ese esquema le pide al botón "Authorize" de Swagger),
# así que declarar OAuth2PasswordBearer solo hacía que ese botón mandara un pedido que /auth/login
# iba a rechazar con 422 (T26-139). HTTPBearer le pide a Swagger un campo de texto simple para
# pegar un token ya obtenido — no intenta loguear desde el dialog.
bearer_scheme = HTTPBearer()

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES"))

# Rate limit de /auth/login por IP (sin dependencia externa: alcanza con un dict en memoria
# para un solo proceso de Uvicorn). Por IP y no por usuario porque también frena probar
# muchas cuentas distintas desde el mismo origen, no solo una cuenta puntual.
# Solo se cuentan los intentos FALLIDOS: un login correcto nunca consume el cupo, así que un
# usuario legítimo (o una suite de tests que loguea seguido) no se ve afectado por este límite.
LOGIN_RATE_LIMIT = 5
LOGIN_RATE_WINDOW_SECONDS = 60
_login_failures: dict[str, list[float]] = defaultdict(list)
_login_failures_lock = threading.Lock()


def _rate_limit_excedido(ip: str) -> bool:
    ahora = time.monotonic()
    with _login_failures_lock:
        fallos = _login_failures[ip]
        fallos[:] = [t for t in fallos if ahora - t < LOGIN_RATE_WINDOW_SECONDS]
        return len(fallos) >= LOGIN_RATE_LIMIT


def _registrar_intento_fallido(ip: str) -> None:
    with _login_failures_lock:
        _login_failures[ip].append(time.monotonic())


def verificar_password(password_plano, password_hash):
    return bcrypt.checkpw(password_plano.encode(), password_hash.encode())

def hashear_password(password):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def crear_token(data: dict):
    datos = data.copy()
    expiracion = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    datos.update({"exp": expiracion})
    return jwt.encode(datos, SECRET_KEY, algorithm=ALGORITHM)

def get_usuario_actual(
    credenciales: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)
):
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = credenciales.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credenciales_invalidas
    except JWTError:
        raise credenciales_invalidas
    usuario = db.query(User).filter(User.email == email).first()
    if usuario is None:
        raise credenciales_invalidas
    return usuario


# Rol con acceso total: no hace falta nombrarlo en cada requiere_rol(...), cualquier
# endpoint protegido por rol acepta admin implícitamente (ver docs/roles-permisos.md).
ROL_ADMIN = "admin"

# Usuario técnico de vision-module (T26-152): reemplaza el admin temporal que se le
# dio en T26-138 para destrabar GET /camaras/ y GET /roi-mesa/. Cubre exactamente lo
# que el módulo usa hoy — nada más — para no seguir corriendo con más privilegio del
# necesario.
ROL_VISION_MODULE = "vision_module"


def requiere_rol(*roles_permitidos: str):
    """Dependencia adicional sobre get_usuario_actual: exige que el usuario autenticado
    tenga uno de los roles indicados (admin siempre pasa). Devuelve 403, no 401, porque
    en este punto el token ya es válido — lo que falta es autorización, no autenticación."""

    def dependencia(usuario: User = Depends(get_usuario_actual)) -> User:
        if usuario.rol != ROL_ADMIN and usuario.rol not in roles_permitidos:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tu rol no tiene permiso para realizar esta acción",
            )
        return usuario

    return dependencia


@router.post("/register", response_model=UserResponse, status_code=201)
def register(
    datos: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(requiere_rol(ROL_ADMIN)),
):
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
def login(datos: UserLogin, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "desconocida"
    if _rate_limit_excedido(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de login. Probá de nuevo en un minuto.",
        )
    usuario = db.query(User).filter(User.email == datos.email).first()
    if not usuario or not verificar_password(datos.password, usuario.password):
        _registrar_intento_fallido(ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )
    token = crear_token({"sub": usuario.email, "rol": usuario.rol})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def me(usuario: User = Depends(get_usuario_actual)):
    return usuario