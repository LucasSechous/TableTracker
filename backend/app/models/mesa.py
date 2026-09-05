# Modelo SQLAlchemy para la tabla mesas.
# Representa una mesa física asociada a un sector del restaurante.

import enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum, UniqueConstraint, text
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
    __table_args__ = (UniqueConstraint("numero", "sector_id", name="uq_mesa_numero_sector"),)

    id = Column(Integer, primary_key=True, index=True)
    numero = Column(Integer, nullable=False)
    sector_id = Column(Integer, ForeignKey("sectores.id"), nullable=False)
    estado = Column(Enum(EstadoMesa), nullable=False, default=EstadoMesa.libre)
    # Desde cuándo la mesa está en su estado actual (T26-173). Es un dato DERIVADO de
    # historial_estados y se guarda igual, denormalizado, por costo: el dashboard pide
    # GET /mesas cada 3 segundos (INTERVALO_REFRESCO_MESAS_MS), o sea ~1200 veces por
    # hora contra una base remota. Calcularlo ahí obligaría a cruzar el historial en
    # cada uno de esos ciclos; teniéndolo en la fila, el endpoint no paga nada extra.
    #
    # Lo mantiene registrar_historial() en app/routers/mesas.py, que es el único lugar
    # por donde pasa un cambio de estado con su fila de historial.
    estado_desde = Column(DateTime(timezone=True), server_default=func.now())
    activa = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # server_default: la base ya lo tenía y el modelo no lo declaraba (T26-137).
    pos_x = Column(Integer, nullable=False, default=0, server_default=text("0"))
    pos_y = Column(Integer, nullable=False, default=0, server_default=text("0"))

    sector = relationship("Sector", back_populates="mesas")
