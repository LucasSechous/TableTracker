# Punto de entrada principal de la API. Inicializa FastAPI,
# conecta la base de datos y registra las rutas del sistema.

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, sectores, mesas, historial
from app.database import Base, engine
from app.models import user, sector, mesa, historial as historial_model  # noqa: F401 — registra modelos para create_all
from dotenv import load_dotenv

load_dotenv()

Base.metadata.create_all(bind=engine)

app = FastAPI(title="TableTracker API")

# Lista explícita de orígenes permitidos, vía env var (CORS_ORIGINS, coma-separado) para poder
# diferenciar desarrollo/producción sin tocar código. allow_credentials=True exige orígenes
# explícitos: la spec de CORS prohíbe combinarlo con "*".
_cors_origins_default = "http://localhost:5173,http://localhost:5174,http://localhost:5175"
CORS_ORIGINS = [
    origin.strip() for origin in os.getenv("CORS_ORIGINS", _cors_origins_default).split(",") if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Autenticación"])
app.include_router(sectores.router, prefix="/sectores", tags=["Sectores"])
app.include_router(mesas.router, prefix="/mesas", tags=["Mesas"])
app.include_router(historial.router, prefix="/historial", tags=["Historial"])

@app.get("/")
def root():
    return {"mensaje": "TableTracker API funcionando"}