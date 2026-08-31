# Modelo SQLAlchemy para la tabla configuracion_general.
# Fila única (id=1, forzado por CHECK en la base) con los parámetros globales del salón.

from sqlalchemy import Column, Integer, String, DateTime, CheckConstraint, text
from sqlalchemy.sql import func
from app.database import Base


class ConfiguracionGeneral(Base):
    __tablename__ = "configuracion_general"
    __table_args__ = (CheckConstraint("id = 1", name="configuracion_general_singleton"),)

    # autoincrement=False: es una fila única, no una secuencia. Sin esto
    # SQLAlchemy trataría el PK entero como SERIAL, que no es lo que hay en la base.
    id = Column(Integer, primary_key=True, autoincrement=False, default=1, server_default=text("1"))
    nombre_establecimiento = Column(String, nullable=True)
    # server_default: la base ya los tenía y el modelo no los declaraba (T26-137).
    ancho_salon = Column(Integer, nullable=False, default=1200, server_default=text("1200"))
    alto_salon = Column(Integer, nullable=False, default=700, server_default=text("700"))
    # RF-28 (T26-156): dato de referencia informativo, no una constraint sobre la
    # cantidad real de mesas activas — por eso nullable, sin default ni relación
    # con COUNT(mesas).
    cantidad_mesas_referencia = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
