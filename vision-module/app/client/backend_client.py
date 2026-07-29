# Cliente HTTP hacia la API de TableTracker.
# Único punto del módulo que conoce los endpoints del backend, para que un
# cambio en la API no se propague al resto del pipeline.

from app.utils.logger import get_logger

logger = get_logger(__name__)


class BackendClient:
    def __init__(self, base_url, token):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    def listar_mesas(self):
        # GET /mesas/ — mesas registradas, para validar los mesa_id de las zonas.
        raise NotImplementedError

    def cambiar_estado(self, mesa_id, estado):
        # PATCH /mesas/{mesa_id}/estado con {"estado": estado}.
        # estado: libre | ocupada | pendiente_limpieza | reservada
        raise NotImplementedError
