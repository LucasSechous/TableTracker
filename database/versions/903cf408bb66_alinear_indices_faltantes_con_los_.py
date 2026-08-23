"""alinear indices faltantes con los modelos

Revision ID: 903cf408bb66
Revises: e72cc6e493dc
Create Date: 2026-08-23

Cierra la única diferencia que quedaba entre la base y los modelos (T26-137).

`camaras.id` y `roi_mesa.id` están declarados con `index=True` en los modelos,
pero Supabase no tiene esos índices: son las dos tablas que T26-125 creó a mano
con DDL suelto, y ahí se perdieron. El resto de las tablas, que nacieron de
`Base.metadata.create_all`, sí los tienen (ix_users_id, ix_sectores_id,
ix_mesas_id, ix_historial_estados_id).

El otro drift que encontró este ticket —11 columnas con DEFAULT en la base que
los modelos sólo declaraban del lado de Python, y el CHECK de
configuracion_general con distinto nombre— no se corrige acá: ahí la base estaba
bien y el que mentía era el modelo, así que se arregló en backend/app/models/.
Esta revisión es la única parte del drift que sí requería tocar la base.

Es una operación barata y no destructiva: son 20 y 9 filas, y CREATE INDEX no
reescribe datos.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "903cf408bb66"
down_revision: Union[str, Sequence[str], None] = "e72cc6e493dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_camaras_id", "camaras", ["id"])
    op.create_index("ix_roi_mesa_id", "roi_mesa", ["id"])


def downgrade() -> None:
    op.drop_index("ix_roi_mesa_id", table_name="roi_mesa")
    op.drop_index("ix_camaras_id", table_name="camaras")
