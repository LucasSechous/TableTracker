"""horario de servicio del local en configuracion_general

Revision ID: 7c3a5e01b8f4
Revises: 4d9e1c7ab205
Create Date: 2026-09-05

Agrega `hora_apertura` y `hora_cierre` para poder acotar las métricas al horario de
servicio real (T26-171). Hasta acá /metricas/rotacion contaba las 24 horas del día,
así que un día de servicio venía mezclado con la madrugada del local cerrado.

Las dos columnas son NULLABLE y sin default, y eso es deliberado: mientras nadie las
cargue, `en_horario_de_servicio()` devuelve True para todo y el conteo queda idéntico
al de antes del ticket. Poner un horario por default activaría el recorte en una
instalación existente sin que nadie lo pida, y los números de las pantallas de
métricas cambiarían de un día para el otro sin explicación.

Son TIME sin huso, no TIMESTAMP: describen "a qué hora abre el local", no un instante.
El huso contra el que se comparan vive en app/services/horario.TZ_LOCAL.

No se agrega constraint de apertura < cierre: un local que abre 20:00 y cierra 02:00
es el caso normal de un restaurante, y la franja que cruza medianoche se resuelve en
código.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7c3a5e01b8f4"
down_revision: Union[str, Sequence[str], None] = "4d9e1c7ab205"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("configuracion_general", sa.Column("hora_apertura", sa.Time(), nullable=True))
    op.add_column("configuracion_general", sa.Column("hora_cierre", sa.Time(), nullable=True))


def downgrade() -> None:
    op.drop_column("configuracion_general", "hora_cierre")
    op.drop_column("configuracion_general", "hora_apertura")
