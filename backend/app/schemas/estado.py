# Schema Pydantic para el listado de solo lectura de estados de mesa (T26-157).

from pydantic import BaseModel

from app.models.mesa import EstadoMesa


class EstadoResponse(BaseModel):
    valor: EstadoMesa
    etiqueta: str
