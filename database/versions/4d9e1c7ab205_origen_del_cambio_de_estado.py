"""origen del cambio de estado en historial_estados

Revision ID: 4d9e1c7ab205
Revises: 841471d74b5b
Create Date: 2026-09-05

Agrega `historial_estados.origen_cambio` para poder distinguir un cambio que puso
la detección automática de uno que corrigió una persona a mano (T26-163). Hasta
acá los dos flujos escribían la misma fila y el dato se perdía.

La columna es NULLABLE a propósito, y ese es el punto de diseño de la revisión.

Lo cómodo sería `NOT NULL DEFAULT 'manual'`, pero eso marcaría como "corrección
manual" a todo el historial ya existente, que en su mayoría lo escribió
vision-module. Sería inventar un dato que nadie registró, y encima uno que después
se lee como si fuera cierto: cualquier métrica de "cuánto corrige el personal"
saldría inflada por filas viejas.

NULL significa exactamente lo que pasó: la fila es anterior a que se registrara el
origen y no se sabe cuál fue. Las filas nuevas siempre traen valor, así que el NULL
deja de aparecer solo con el tiempo, sin necesidad de un backfill que no tendría de
dónde sacar la verdad.

No se toca `estadomesa`: el tipo `origencambio` es nuevo y lo crea esta revisión
(`checkfirst=True` para que reaplicarla no explote).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4d9e1c7ab205"
down_revision: Union[str, Sequence[str], None] = "841471d74b5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Los valores tienen que coincidir con OrigenCambio en backend/app/models/historial.py.
ORIGEN_CAMBIO = sa.Enum("automatico", "manual", name="origencambio")


def upgrade() -> None:
    # El tipo se crea explícitamente y no se deja a add_column: con checkfirst=True la
    # revisión es reaplicable si el tipo ya quedó creado por un intento anterior.
    ORIGEN_CAMBIO.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "historial_estados",
        sa.Column("origen_cambio", ORIGEN_CAMBIO, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("historial_estados", "origen_cambio")
    # El tipo se borra después de la columna: al revés, Postgres lo rechaza por dependencia.
    ORIGEN_CAMBIO.drop(op.get_bind(), checkfirst=True)
