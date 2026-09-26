"""umbral de alta ocupación del salón

Revision ID: c17e4a90d3b2
Revises: b042ca591eb4
Create Date: 2026-09-09

Una columna para T26-187 (RF-26):

* `configuracion_general.umbral_ocupacion_alta` — a partir de qué porcentaje de mesas
  ocupadas sobre el total de mesas activas el salón se considera al límite.

Es un porcentaje (0-100), en las mismas unidades que `porcentaje_ocupacion` de
GET /metricas/ocupacion, para poder compararlos sin convertir nada en el medio. La
alternativa —guardar una fracción 0-1 como overlap_minimo— obligaría a que cada lado de
la comparación recordara en qué escala está el otro.

Se agrega NOT NULL con default 85, que es lo que pide el ticket. A diferencia de
minutos_limpieza_demorada (nullable, alerta apagada hasta que alguien la configure), acá un
default sí tiene sentido: "85% del salón ocupado" significa lo mismo en cualquier local,
mientras que cuánto puede demorarse una limpieza no.

Consecuencia a tener en cuenta al aplicarla: una instalación existente pasa a tener la
alerta ENCENDIDA con 85% desde el momento del upgrade. Es el comportamiento pedido, pero es
un cambio visible el mismo día, no una función latente como la de T26-183.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c17e4a90d3b2"
down_revision: Union[str, Sequence[str], None] = "b042ca591eb4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuracion_general",
        sa.Column("umbral_ocupacion_alta", sa.Float(), nullable=False, server_default=sa.text("85")),
    )
    op.create_check_constraint(
        "configuracion_general_umbral_ocupacion_alta_valido",
        "configuracion_general",
        "umbral_ocupacion_alta > 0 AND umbral_ocupacion_alta <= 100",
    )


def downgrade() -> None:
    op.drop_constraint(
        "configuracion_general_umbral_ocupacion_alta_valido", "configuracion_general", type_="check"
    )
    op.drop_column("configuracion_general", "umbral_ocupacion_alta")
