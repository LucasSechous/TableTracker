"""umbral de limpieza demorada y reloj de estado en mesas

Revision ID: 9b2f1d64ce70
Revises: 7c3a5e01b8f4
Create Date: 2026-09-05

Dos columnas para T26-173:

* `configuracion_general.minutos_limpieza_demorada` — cuántos minutos puede estar una
  mesa en pendiente_limpieza antes de considerarse atrasada. Nullable y sin default: sin
  cargar, la alerta queda apagada y el canvas se ve igual que antes.

* `mesas.estado_desde` — desde cuándo la mesa está en su estado actual.

Sobre `estado_desde`: es un dato derivado de historial_estados y aun así se guarda
denormalizado. El motivo es el costo de lectura, no la comodidad. El dashboard llama
GET /mesas cada 3 segundos (INTERVALO_REFRESCO_MESAS_MS en DashboardPage.tsx), unas 1200
veces por hora contra una base remota; resolver "hace cuánto está en este estado" ahí
obligaría a cruzar el historial en cada ciclo. Teniéndolo en la fila, el endpoint más
pedido de la aplicación no paga nada extra.

El upgrade hace backfill con la fecha de la última fila de historial de cada mesa, que es
exactamente el dato que la columna representa. A diferencia del backfill que se descartó
en 4d9e1c7ab205 (origen_cambio), acá no se está inventando nada: el valor existe y solo
se lo está copiando a donde se puede leer barato. Las mesas sin historial —nunca
cambiaron de estado desde que se crearon— caen a `created_at`, que es su verdad.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9b2f1d64ce70"
down_revision: Union[str, Sequence[str], None] = "7c3a5e01b8f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuracion_general", sa.Column("minutos_limpieza_demorada", sa.Integer(), nullable=True)
    )
    op.add_column(
        "mesas",
        sa.Column("estado_desde", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )

    # Backfill. Sin esto, todas las mesas arrancarían con estado_desde = ahora y el panel
    # mostraría "recién" para mesas que llevan horas en el mismo estado.
    op.execute(
        """
        UPDATE mesas
        SET estado_desde = COALESCE(
            (
                SELECT MAX(h.created_at)
                FROM historial_estados h
                WHERE h.mesa_id = mesas.id
            ),
            mesas.created_at
        )
        """
    )


def downgrade() -> None:
    op.drop_column("mesas", "estado_desde")
    op.drop_column("configuracion_general", "minutos_limpieza_demorada")
