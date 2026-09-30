from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.models.mesa import EstadoMesa
from app.schemas.sector import SectorResponse


class MesaCreate(BaseModel):
    numero: int
    sector_id: int
    estado: EstadoMesa = EstadoMesa.libre
    activa: bool = True


class MesaUpdate(BaseModel):
    numero: Optional[int] = None
    sector_id: Optional[int] = None
    estado: Optional[EstadoMesa] = None
    activa: Optional[bool] = None


class EstadoUpdate(BaseModel):
    estado: EstadoMesa


class ReservaUpdate(BaseModel):
    """Cuerpo opcional de PATCH /mesas/{id}/reserva.

    `reservada_para` es opcional y el endpoint acepta que no venga cuerpo, para no
    romper a quien ya reservaba sin hora. Reservar sin decir para cuándo sigue siendo
    válido; simplemente no se puede avisar del atraso.
    """

    reservada_para: Optional[datetime] = None


class PosicionUpdate(BaseModel):
    pos_x: int
    pos_y: int


class MesaResponse(BaseModel):
    id: int
    numero: int
    sector_id: int
    sector: SectorResponse
    estado: EstadoMesa
    activa: bool
    created_at: datetime
    # Desde cuándo está en este estado (T26-173). Viene denormalizado en la fila, no
    # calculado: este endpoint lo pide el dashboard cada 3 segundos.
    estado_desde: Optional[datetime] = None
    # Para cuándo está reservada, o None si se reservó sin decir hora (T26-208).
    reservada_para: Optional[datetime] = None
    # Hay gente sentada en una mesa reservada, esperando que alguien decida si
    # corresponde ocuparla (T26-208). None cuando no hay nada pendiente.
    ocupacion_detectada_en: Optional[datetime] = None
    pos_x: int = 0
    pos_y: int = 0
    # Posible error de detección (T26-188, RF-27): la mesa sigue 'ocupada' con el local
    # cerrado, teniendo cobertura de cámara. Ver services/estado_dudoso.py para el criterio.
    #
    # Se calcula por request y no se guarda en la fila —a diferencia de estado_desde, que sí
    # es una columna—: depende de qué hora es, así que un valor persistido quedaría viejo
    # solo por el paso del tiempo, sin que nadie tocara la mesa.
    #
    # Default False y no None: los caminos que devuelven una mesa sin pasar por
    # marcar_estados_dudosos() (el POST de alta, el PATCH de estado) responden "no dudosa",
    # que es lo correcto para una mesa recién tocada, en vez de un null que cada cliente
    # tendría que interpretar.
    estado_dudoso: bool = False

    model_config = {"from_attributes": True}
