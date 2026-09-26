# Validaciones compartidas entre routers (T26-200/B-2).
#
# Vive en routers/ y no en services/ a propósito: lo que hay acá traduce una condición de
# dominio a una respuesta HTTP (levanta HTTPException). services/ es para lógica que no sabe
# que existe una API — horario.py y ocupacion.py se pueden llamar desde un script y no
# cambian de comportamiento.
#
# Nace con una sola función porque era la que estaba copiada siete veces. La auditoría de
# T26-133 la contó en cinco sitios; al relevar de nuevo para este ticket eran siete: T26-185
# y T26-186 sumaron una cada uno al crear sus endpoints, copiando la línea del de al lado.
# Ese es el argumento para que exista este módulo y no una octava copia.

from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.sector import Sector


def validar_sector(db: Session, sector_id: Optional[int]) -> None:
    """400 si se pidió filtrar por un sector que no existe.

    Acepta None y no hace nada: todos los llamadores reciben el sector_id como query param
    opcional, así que el "no filtrar" es el caso normal y no un error. Tenerlo acá adentro
    evita que cada llamador repita el `if sector_id is not None`.

    Es 400 y no 404 a propósito: el recurso pedido (la lista de mesas, el reporte) existe; lo
    que está mal es el parámetro con el que se lo pidió.
    """
    if sector_id is not None and not db.query(Sector).filter(Sector.id == sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")
