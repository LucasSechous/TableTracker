# Schema Pydantic para la tabla historial_estados.
# Define el shape de salida del historial de cambios de estado de mesas.

from pydantic import BaseModel
from datetime import datetime
from app.models.mesa import EstadoMesa


class HistorialEstadoResponse(BaseModel):
    id: int
    mesa_id: int
    estado: EstadoMesa
    created_at: datetime

    model_config = {"from_attributes": True}
