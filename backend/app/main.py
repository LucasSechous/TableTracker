# Punto de entrada principal de la API. Inicializa FastAPI y registra las rutas
# del sistema.
#
# Acá NO se crea el esquema. Hasta T26-137 este módulo llamaba a
# `Base.metadata.create_all(bind=engine)` al importarse, y esa era justamente la
# causa del drift silencioso que el ticket vino a cerrar: create_all crea las
# tablas que faltan pero nunca altera las que ya están, así que un entorno nuevo
# nacía con el esquema de los modelos y producción seguía con el suyo, sin que
# nadie se enterara. El esquema ahora lo gobiernan las revisiones de Alembic:
#
#   alembic -c database/alembic.ini upgrade head
#
# Ver database/README.md. Los modelos tampoco se importan más desde acá: los
# siete routers ya importan los siete, y quien necesita el metadata completo
# (Alembic) lo arma en database/env.py.

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, sectores, mesas, historial, camaras, roi, configuracion, metricas, estados
from dotenv import load_dotenv

load_dotenv()

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
app.include_router(metricas.router, prefix="/metricas", tags=["Métricas"])
app.include_router(estados.router, prefix="/estados", tags=["Estados"])

app.include_router(camaras.router, prefix="/camaras", tags=["Cámaras"])
app.include_router(roi.router, prefix="/roi-mesa", tags=["ROI por mesa"])
app.include_router(configuracion.router, prefix="/configuracion", tags=["Configuración"])

@app.get("/")
def root():
    return {"mensaje": "TableTracker API funcionando"}