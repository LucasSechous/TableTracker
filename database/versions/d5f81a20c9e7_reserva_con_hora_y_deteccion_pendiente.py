"""hora de la reserva y deteccion pendiente de confirmacion en mesas

Revision ID: d5f81a20c9e7
Revises: c17e4a90d3b2
Create Date: 2026-09-29

Dos columnas en `mesas`, las dos nullable y sin default, para T26-208.

`reservada_para` — para qué momento está reservada la mesa.

Hasta ahora el sistema sabía QUE una mesa estaba reservada pero no para cuándo:
`PATCH /mesas/{id}/reserva` solo ponía el estado. Eso no representa cómo funciona el
negocio —una hostess reserva para una hora concreta— y deja sin responder la pregunta que
alguien se hace mirando el salón: a qué hora llega esa gente.

Se guarda el momento completo y no una hora suelta. Un "21:00" pelado es ambiguo entre
días y vuelve incalculable "cuánto se pasó" cuando el servicio cruza la medianoche.

Nullable a propósito: las mesas que hoy ya están reservadas no tienen hora, y la
aplicación tiene que seguir funcionando con ellas. Sin hora, la etiqueta del salón cae al
tiempo transcurrido, que es lo que se mostraba antes. No hay backfill posible acá —a
diferencia de `estado_desde` en 9b2f1d64ce70, donde el dato existía en el historial y solo
había que copiarlo, este dato nunca se registró y no se puede inventar.

`ocupacion_detectada_en` — cuándo el módulo de visión vio gente en una mesa reservada
fuera de la ventana de tolerancia, sin que nadie lo haya resuelto todavía.

Hasta ahora la política del módulo (vision-module/app/mapping/politica.py) mandaba
`reservada + hay gente -> ocupada`, con el comentario "llegó quien había reservado". Es un
supuesto, y falla justo en el caso que motiva esto: alguien se sienta sin ver que la mesa
está reservada, y al rato se va. Marcarla ocupada borra la reserva de la pantalla.

Con esta columna la mesa SIGUE reservada y queda anotado que hay alguien sentado, para que
la decisión la tome una persona. Es deliberadamente una marca y no un quinto estado: meter
`pendiente_confirmacion` en el enum se propaga a colores, iconos, leyenda, filtro,
métricas, historial y a este mismo esquema, y lo único que hace falta es señalar una
condición sobre un estado que ya existe. Mismo criterio con el que COLOR_LIMPIEZA_DEMORADA
no entró en COLOR_POR_ESTADO.

Las dos se limpian cuando la mesa deja de estar reservada. Sin eso, una mesa ocupada
arrastraría la hora de una reserva ya consumida y el aviso de una detección ya resuelta.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d5f81a20c9e7"
down_revision: Union[str, Sequence[str], None] = "c17e4a90d3b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("mesas", sa.Column("reservada_para", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "mesas", sa.Column("ocupacion_detectada_en", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("mesas", "ocupacion_detectada_en")
    op.drop_column("mesas", "reservada_para")
