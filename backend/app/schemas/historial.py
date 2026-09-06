# Schema Pydantic para la tabla historial_estados.
# Define el shape de salida del historial de cambios de estado de mesas.

from pydantic import BaseModel
from datetime import datetime
from app.models.mesa import EstadoMesa
from app.models.historial import OrigenCambio


class HistorialEstadoResponse(BaseModel):
    id: int
    mesa_id: int
    estado: EstadoMesa
    created_at: datetime
    # None en las filas anteriores a T26-163: no es "se desconoce por error" sino "se
    # registró antes de que el origen existiera". Quien lo consuma tiene que distinguir
    # ese caso de un automatico/manual real.
    origen_cambio: OrigenCambio | None = None

    model_config = {"from_attributes": True}
