from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
from datetime import datetime

# Mínimo de puntos para que el polígono encierre un área: con dos es un segmento.
MIN_PUNTOS_POLIGONO = 3

# En RoiMesaUpdate todos los campos son Optional para poder mandar solo los que
# cambian, pero ninguno admite null: en la base son NOT NULL, así que anularlos
# terminaría en un error de integridad en vez de en un 422 entendible.
_NO_ANULABLES = ("mesa_id", "camara_id", "coordenadas", "activa")


def _validar_coordenadas(puntos: list) -> list:
    if len(puntos) < MIN_PUNTOS_POLIGONO:
        raise ValueError(f"El ROI necesita al menos {MIN_PUNTOS_POLIGONO} puntos para encerrar un área")

    normalizado = []
    for indice, punto in enumerate(puntos, start=1):
        if len(punto) != 2:
            raise ValueError(f"El punto {indice} tiene que ser exactamente [x, y]")
        x, y = punto
        # Son coordenadas de píxel dentro del frame: negativas no existen. El
        # límite superior depende de la resolución de la cámara, que el backend
        # no conoce, así que esa validación queda del lado del módulo de visión.
        if x < 0 or y < 0:
            raise ValueError(f"El punto {indice} tiene coordenadas negativas: [{x}, {y}]")
        normalizado.append([x, y])
    return normalizado


class RoiMesaCreate(BaseModel):
    mesa_id: int
    camara_id: int
    # [[x, y], ...] en píxeles del frame — mismo formato que vision-module/config/zonas.json
    coordenadas: list[list[int]]
    activa: bool = True

    @field_validator("coordenadas")
    @classmethod
    def validar_coordenadas(cls, valor):
        return _validar_coordenadas(valor)


class RoiMesaUpdate(BaseModel):
    mesa_id: Optional[int] = None
    camara_id: Optional[int] = None
    coordenadas: Optional[list[list[int]]] = None
    activa: Optional[bool] = None

    @field_validator("coordenadas")
    @classmethod
    def validar_coordenadas(cls, valor):
        return valor if valor is None else _validar_coordenadas(valor)

    @model_validator(mode="after")
    def rechazar_nulos(self):
        nulos = [c for c in _NO_ANULABLES if c in self.model_fields_set and getattr(self, c) is None]
        if nulos:
            raise ValueError(f"No se pueden poner en null estos campos: {', '.join(nulos)}")
        return self


class RoiMesaResponse(BaseModel):
    id: int
    mesa_id: int
    # Datos de contexto para no obligar a la UI a cruzar con /mesas y /camaras.
    mesa_numero: Optional[int]
    camara_id: int
    camara_nombre: Optional[str]
    coordenadas: list[list[int]]
    activa: bool
    created_at: datetime

    model_config = {"from_attributes": True}
