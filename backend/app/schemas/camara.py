from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
from datetime import datetime
from app.schemas.sector import SectorResponse
from app.services import rtsp

# En CamaraUpdate todos los campos son Optional para poder mandar solo los que
# cambian, pero estos no admiten null: anularlos terminaría en un error de
# integridad en vez de en un 422 entendible. `rtsp_url` ya no es una columna
# —desde T26-136 se reparte en esquema/host/puerto/ruta/usuario/password_cifrada,
# y host es NOT NULL— pero sigue siendo el campo de entrada, así que anularlo
# tampoco tiene sentido.
_NO_ANULABLES = ("nombre", "rtsp_url", "sector_id", "activa")


def _validar_rtsp_url(valor: str) -> str:
    url = valor.strip()
    try:
        datos = rtsp.parsear_url(url)
    except ValueError as error:
        raise ValueError(f"La URL RTSP no es válida: {error}")
    # La API devuelve la URL con la contraseña tapada; si vuelve así en una
    # edición es que el cliente reenvió lo que le mostramos, y guardarla dejaría
    # «***» como contraseña real.
    if datos.password == rtsp.PASSWORD_ENMASCARADA:
        raise ValueError(
            "La URL viene con la contraseña enmascarada («***»). Mandá la URL completa con la "
            "contraseña real, o dejá el campo afuera para no tocarla."
        )
    return url


class CamaraCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    # rtsp://usuario:password@host:puerto/ruta
    rtsp_url: str
    sector_id: int
    activa: bool = True

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor):
        return valor.strip()

    @field_validator("rtsp_url")
    @classmethod
    def validar_url(cls, valor):
        return _validar_rtsp_url(valor)


class CamaraUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=100)
    rtsp_url: Optional[str] = None
    sector_id: Optional[int] = None
    activa: Optional[bool] = None

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor):
        return valor if valor is None else valor.strip()

    @field_validator("rtsp_url")
    @classmethod
    def validar_url(cls, valor):
        return valor if valor is None else _validar_rtsp_url(valor)

    @model_validator(mode="after")
    def rechazar_nulos(self):
        nulos = [c for c in _NO_ANULABLES if c in self.model_fields_set and getattr(self, c) is None]
        if nulos:
            raise ValueError(f"No se pueden poner en null estos campos: {', '.join(nulos)}")
        return self


class CamaraResponse(BaseModel):
    id: int
    nombre: str
    sector_id: int
    sector: SectorResponse
    # Enmascarada: la contraseña nunca sale de la API. Para editarla hay que
    # mandar la URL completa de nuevo (ver validación en CamaraUpdate).
    rtsp_url: str = Field(validation_alias="rtsp_url_enmascarada")
    tiene_credenciales: bool
    activa: bool
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class CamaraTestResponse(BaseModel):
    ok: bool
    mensaje: str
    codigo_rtsp: Optional[int] = None
    latencia_ms: Optional[int] = None
    rtsp_url: str
