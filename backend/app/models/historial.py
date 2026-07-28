# Modelo SQLAlchemy para la tabla historial_estados.
# Registra cada cambio de estado de una mesa para su consulta posterior.

from sqlalchemy import Column, Integer, ForeignKey, Enum, DateTime
from sqlalchemy.sql import func
from app.database import Base
from app.models.mesa import EstadoMesa


class HistorialEstado(Base):
    __tablename__ = "historial_estados"

    id = Column(Integer, primary_key=True, index=True)
    mesa_id = Column(Integer, ForeignKey("mesas.id", name="historial_estados_mesa_id_fkey"), nullable=False)
    estado = Column(Enum(EstadoMesa, name="estadomesa", create_type=False), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
