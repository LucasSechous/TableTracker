# Configuración de la conexión a la base de datos PostgreSQL en Supabase.
# Provee el motor, la sesión y la clase base para los modelos.

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def es_violacion_unique(error: IntegrityError, constraint: str, *columnas: str) -> bool:
    """¿Este IntegrityError es la violación de esa constraint UNIQUE en particular?

    Hace falta distinguirla de un choque de FK, que también levanta IntegrityError:
    contestar «ya existe una cámara con ese nombre» porque desapareció el sector
    sería mentir sobre lo que pasó.

    Los dos motores no lo dicen igual (T26-165). Postgres nombra la constraint en el
    mensaje, que es lo más preciso y es lo que corre en producción. SQLite no la
    nombra —dice «UNIQUE constraint failed: camaras.nombre»— y es el motor contra el
    que testea el repo, así que también se acepta esa forma. La distinción con la FK
    se mantiene en los dos: un error de FK nunca dice «UNIQUE constraint failed».
    """
    texto = str(error.orig)
    if constraint in texto:
        return True
    return "UNIQUE constraint failed" in texto and all(f".{c}" in texto for c in columnas)
