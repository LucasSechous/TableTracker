# Modelo SQLAlchemy para la tabla configuracion_general.
# Fila única (id=1, forzado por CHECK en la base) con los parámetros globales del salón.

from sqlalchemy import Column, Integer, String, DateTime, CheckConstraint
from sqlalchemy.sql import func
from app.database import Base


class ConfiguracionGeneral(Base):
    __tablename__ = "configuracion_general"
    __table_args__ = (CheckConstraint("id = 1", name="configuracion_general_id_check"),)

    id = Column(Integer, primary_key=True, default=1)
    nombre_establecimiento = Column(String, nullable=True)
    ancho_salon = Column(Integer, nullable=False, default=1200)
    alto_salon = Column(Integer, nullable=False, default=700)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
