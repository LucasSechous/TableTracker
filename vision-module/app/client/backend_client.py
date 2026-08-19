# Cliente HTTP hacia la API de TableTracker.
# Único punto del módulo que conoce los endpoints del backend, para que un
# cambio en la API no se propague al resto del pipeline.
#
# El módulo entra con su propio usuario (T26-129): se loguea con email y
# contraseña y guarda el token en memoria. No se lleva un token pegado en el
# .env porque el del backend vence a los 30 minutos y un proceso que corre todo
# el servicio lo vería expirar; acá el 401 se resuelve reloqueándose una vez y
# reintentando el pedido, de forma transparente para el pipeline.

import requests

from app.utils.logger import get_logger

logger = get_logger(__name__)


class ErrorBackend(Exception):
    # Falla al hablar con la API. El pipeline la atrapa para no morirse por un
    # backend caído: se loguea y se sigue con el próximo frame.
    pass


class CredencialesInvalidas(ErrorBackend):
    # El usuario del módulo no existe, está mal la contraseña o el rol no
    # alcanza. A diferencia de ErrorBackend no tiene sentido reintentarla:
    # reventar al arrancar es preferible a un loop que no puede hacer nada.
    pass


class BackendClient:
    def __init__(self, base_url, email, password, timeout=10):
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.timeout = timeout
        self.token = None
        self.sesion = requests.Session()

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def login(self):
        """Pide un token nuevo. Se llama al arrancar y cada vez que el actual vence."""
        try:
            respuesta = self.sesion.post(
                f"{self.base_url}/auth/login",
                json={"email": self.email, "password": self.password},
                timeout=self.timeout,
            )
        except requests.RequestException as error:
            raise ErrorBackend(f"No se pudo contactar la API en {self.base_url}: {error}") from error

        if respuesta.status_code == 401:
            raise CredencialesInvalidas(
                f"La API rechazó las credenciales de {self.email}: revisá BACKEND_EMAIL y BACKEND_PASSWORD"
            )
        if respuesta.status_code == 429:
            # El backend limita los intentos fallidos por IP (5 por minuto).
            raise ErrorBackend("La API está limitando los intentos de login: esperá un minuto")
        if not respuesta.ok:
            raise ErrorBackend(f"Login fallido ({respuesta.status_code}): {_detalle(respuesta)}")

        self.token = respuesta.json()["access_token"]
        logger.info("Autenticado en la API como %s", self.email)

    def _request(self, metodo, ruta, **kwargs):
        # Un 401 acá es token vencido (el login ya validó que las credenciales
        # sirven), así que se renueva y se reintenta una sola vez: si el segundo
        # intento vuelve a dar 401 el problema es otro y hay que verlo.
        respuesta = self._enviar(metodo, ruta, **kwargs)
        if respuesta.status_code == 401:
            logger.info("Token vencido, renovando")
            self.login()
            respuesta = self._enviar(metodo, ruta, **kwargs)

        if respuesta.status_code == 403:
            raise CredencialesInvalidas(
                f"El usuario {self.email} no tiene permiso para {metodo} {ruta}. "
                "Revisá el rol del usuario técnico (T26-129): /camaras y /roi-mesa son solo admin."
            )
        if not respuesta.ok:
            raise ErrorBackend(f"{metodo} {ruta} devolvió {respuesta.status_code}: {_detalle(respuesta)}")
        return respuesta

    def _enviar(self, metodo, ruta, **kwargs):
        try:
            return self.sesion.request(
                metodo, f"{self.base_url}{ruta}", headers=self._headers(), timeout=self.timeout, **kwargs
            )
        except requests.RequestException as error:
            raise ErrorBackend(f"{metodo} {ruta} falló: {error}") from error

    def listar_camaras(self, sector_id=None):
        # GET /camaras/ — solo las activas. `rtsp_url` viene con la contraseña
        # enmascarada; la completa app.utils.rtsp_url antes de abrir el stream.
        params = {} if sector_id is None else {"sector_id": sector_id}
        return self._request("GET", "/camaras/", params=params).json()

    def listar_rois(self, camara_id):
        # GET /roi-mesa/ — solo los ROI activos de esa cámara.
        return self._request("GET", "/roi-mesa/", params={"camara_id": camara_id}).json()

    def listar_mesas(self, sector_id=None):
        # GET /mesas/ — solo las activas, para validar los mesa_id de los ROI.
        params = {} if sector_id is None else {"sector_id": sector_id}
        return self._request("GET", "/mesas/", params=params).json()

    def obtener_mesa(self, mesa_id):
        # GET /mesas/{id} — se consulta justo antes de cada cambio para decidir
        # sobre el estado real y no sobre una copia vieja: entre dos cambios de
        # una misma mesa pasan segundos en los que un mozo pudo tocarla.
        return self._request("GET", f"/mesas/{mesa_id}").json()

    def cambiar_estado(self, mesa_id, estado):
        # PATCH /mesas/{mesa_id}/estado con {"estado": estado}.
        # estado: libre | ocupada | pendiente_limpieza | reservada
        return self._request("PATCH", f"/mesas/{mesa_id}/estado", json={"estado": estado}).json()

    def publicar_deteccion_actual(self, camara_id, payload):
        # POST /camaras/{camara_id}/deteccion-actual — resultado crudo del frame
        # para la vista en vivo (T26-150). 204 sin cuerpo: nada que parsear de
        # vuelta. Igual que el resto de los métodos, no atrapa sus propios
        # errores: quien llama (main.publicar_deteccion_actual) decide qué hacer
        # con ErrorBackend/CredencialesInvalidas — acá es información secundaria,
        # así que ese llamador la trata distinto de un cambio de estado.
        self._request("POST", f"/camaras/{camara_id}/deteccion-actual", json=payload)


def _detalle(respuesta):
    # El backend contesta los errores como {"detail": "..."}; si no, se muestra
    # el cuerpo recortado para no volcar un HTML entero al log.
    try:
        return respuesta.json().get("detail", respuesta.text[:200])
    except ValueError:
        return respuesta.text[:200]
