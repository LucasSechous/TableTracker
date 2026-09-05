# Modelo SQLAlchemy para la tabla historial_estados.
# Registra cada cambio de estado de una mesa para su consulta posterior.

import enum

from sqlalchemy import Column, Integer, ForeignKey, Enum, DateTime
from sqlalchemy.sql import func
from app.database import Base
from app.models.mesa import EstadoMesa


class OrigenCambio(str, enum.Enum):
    """Quién provocó el cambio de estado (T26-163).

    No es "qué rol tenía el usuario" sino "esto lo decidió una máquina o una persona":
    lo que interesa medir después es cuánto acierta la detección y cuánto hay que
    corregirla a mano, y para eso los roles humanos son todos equivalentes.
    """

    automatico = "automatico"
    manual = "manual"


class HistorialEstado(Base):
    __tablename__ = "historial_estados"

    id = Column(Integer, primary_key=True, index=True)
    mesa_id = Column(Integer, ForeignKey("mesas.id", name="historial_estados_mesa_id_fkey"), nullable=False)
    estado = Column(Enum(EstadoMesa, name="estadomesa", create_type=False), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Nullable a propósito: las filas anteriores a T26-163 no registraron el origen y NULL
    # dice exactamente eso. Ponerles 'manual' por default las marcaría como correcciones de
    # personal que nunca ocurrieron —la mayoría las escribió vision-module— e inflaría
    # cualquier métrica que se calcule después sobre este campo.
    origen_cambio = Column(Enum(OrigenCambio), nullable=True)
