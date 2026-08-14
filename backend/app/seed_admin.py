# Script de bootstrap: crea el primer usuario admin directamente en la base.
# Necesario porque POST /auth/register ahora exige ya ser admin (T26-116), así que
# no hay forma de crear el primer usuario del sistema a través de la API.
#
# Uso (desde backend/, con el venv activado):
#   ADMIN_EMAIL=admin@tabletracker.com ADMIN_PASSWORD=cambiar-esto python -m app.seed_admin
#
# Es idempotente: si el email ya existe, no hace nada.

import os

from app.database import SessionLocal
from app.models.user import User
from app.routers.auth import ROL_ADMIN, hashear_password


def seed_admin() -> None:
    nombre = os.getenv("ADMIN_NOMBRE", "Administrador")
    email = os.getenv("ADMIN_EMAIL")
    password = os.getenv("ADMIN_PASSWORD")
    if not email or not password:
        raise SystemExit("Faltan las variables de entorno ADMIN_EMAIL / ADMIN_PASSWORD")

    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == email).first():
            print(f"Ya existe un usuario con email {email}; no se crea nada.")
            return
        admin = User(
            nombre=nombre,
            email=email,
            password=hashear_password(password),
            rol=ROL_ADMIN,
        )
        db.add(admin)
        db.commit()
        print(f"Usuario admin creado: {email}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_admin()
