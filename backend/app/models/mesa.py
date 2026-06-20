import enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class EstadoMesa(str, enum.Enum):
    libre = "libre"
    ocupada = "ocupada"
    pendiente_limpieza = "pendiente_limpieza"
    reservada = "reservada"


class Mesa(Base):
    __tablename__ = "mesas"

    id = Column(Integer, primary_key=True, index=True)
    numero = Column(Integer, nullable=False)
    sector_id = Column(Integer, ForeignKey("sectores.id"), nullable=False)
    estado = Column(Enum(EstadoMesa), nullable=False, default=EstadoMesa.libre)
    activa = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sector = relationship("Sector", back_populates="mesas")
