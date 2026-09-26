"""umbrales de detección editables desde la aplicación

Revision ID: b042ca591eb4
Revises: 9b2f1d64ce70
Create Date: 2026-09-07

Dos columnas para T26-183 (RF-28), prioridad 2 de la épica de vision-module:

* `configuracion_general.confirmacion_segundos` — cuánto tiene que sostenerse una
  observación antes de confirmar el cambio de estado de una mesa.
* `configuracion_general.overlap_minimo` — qué fracción del bounding box de una persona
  tiene que caer dentro del ROI de una mesa para contarla como ocupada.

Los dos vivían en el .env de vision-module (CONFIRMACION_SEGUNDOS y OVERLAP_MINIMO en
app/config.py) y ajustarlos exigía entrar a la máquina, editar el archivo y reiniciar el
proceso — justo lo que este ticket viene a evitar. Se agregan NOT NULL con el mismo default
que tenía el .env, así que una instalación existente no cambia de comportamiento el día que
se aplica esta migración: sigue detectando exactamente igual hasta que un admin toque la
pantalla de configuración.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b042ca591eb4"
down_revision: Union[str, Sequence[str], None] = "9b2f1d64ce70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuracion_general",
        sa.Column("confirmacion_segundos", sa.Float(), nullable=False, server_default=sa.text("6")),
    )
    op.add_column(
        "configuracion_general",
        sa.Column("overlap_minimo", sa.Float(), nullable=False, server_default=sa.text("0.30")),
    )
    op.create_check_constraint(
        "configuracion_general_confirmacion_segundos_positiva",
        "configuracion_general",
        "confirmacion_segundos > 0",
    )
    op.create_check_constraint(
        "configuracion_general_overlap_minimo_valido",
        "configuracion_general",
        "overlap_minimo > 0 AND overlap_minimo <= 1",
    )


def downgrade() -> None:
    op.drop_constraint("configuracion_general_overlap_minimo_valido", "configuracion_general", type_="check")
    op.drop_constraint(
        "configuracion_general_confirmacion_segundos_positiva", "configuracion_general", type_="check"
    )
    op.drop_column("configuracion_general", "overlap_minimo")
    op.drop_column("configuracion_general", "confirmacion_segundos")
