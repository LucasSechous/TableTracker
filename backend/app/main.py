# Punto de entrada principal de la API. Inicializa FastAPI, 
# conecta la base de datos y registra las rutas del sistema.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth
from app.database import Base, engine
from dotenv import load_dotenv

load_dotenv()

Base.metadata.create_all(bind=engine)

app = FastAPI(title="TableTracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Autenticación"])

@app.get("/")
def root():
    return {"mensaje": "TableTracker API funcionando"}