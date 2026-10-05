"""sembrar la fila única de configuracion_general

Revision ID: 7db753755bb9
Revises: d5f81a20c9e7
Create Date: 2026-10-02

`configuracion_general` es una tabla singleton: el CHECK `configuracion_general_singleton`
la fuerza a `id = 1` y el router la busca siempre por ese id. La revisión inicial crea la
tabla, pero **nadie insertaba su única fila**: ni una migración, ni `seed_admin.py`, ni un
hook de arranque. El único lugar del repo que la creaba era el fixture de
`backend/tests/test_configuracion.py`, que la arma a mano en cada test.

Consecuencia en una instalación nueva, levantada solo con `alembic upgrade head`:
`_obtener_fila()` no encuentra nada y `GET /configuracion` responde **404**. Con eso quedan
fuera de servicio la pantalla de configuración (RF-28) y todo lo que se edita desde ahí —
umbral de limpieza demorada (RF-25), umbral de alta ocupación (RF-26) y los umbrales de
detección que `vision-module` relee en caliente. No se había detectado antes porque en
Supabase la fila existe desde que la tabla se creó a mano, en la época anterior a Alembic.

Se inserta **solo el `id`**: todas las columnas NOT NULL tienen `server_default` en la base
—salón 1200x700 (revisión inicial), `confirmacion_segundos` 6 y `overlap_minimo` 0.30
(b042ca591eb4), `umbral_ocupacion_alta` 85 (c17e4a90d3b2)— así que la fila nace con los
mismos valores que ya documentan esas revisiones, sin repetirlos acá y sin riesgo de que
las dos definiciones se separen.

Las columnas nullable se dejan vacías a propósito, por el mismo criterio con el que se
agregaron: `minutos_limpieza_demorada` apagada hasta que alguien la configure,
`hora_apertura`/`hora_cierre` sin recorte (métricas sobre 24 h) y `nombre_establecimiento`
/ `cantidad_mesas_referencia` sin inventar datos del local.

`ON CONFLICT DO NOTHING` la hace idempotente: en los entornos que ya tienen la fila —
Supabase, y cualquier base creada antes de esta revisión — el upgrade no toca nada y, sobre
todo, no pisa la configuración real del establecimiento con los defaults.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "7db753755bb9"
down_revision: Union[str, Sequence[str], None] = "d5f81a20c9e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ON CONFLICT es sintaxis de PostgreSQL. Es el único motor contra el que corren las
    # migraciones: la suite de backend no las usa, arma su esquema con
    # Base.metadata.create_all sobre SQLite (ver backend/tests/conftest.py).
    op.execute(
        "INSERT INTO configuracion_general (id) VALUES (1) ON CONFLICT (id) DO NOTHING"
    )


def downgrade() -> None:
    # A propósito no hace nada. Borrar la fila no devolvería la base a su estado anterior:
    # se llevaría puesta la configuración del establecimiento —nombre, horario de servicio,
    # umbrales de limpieza, de ocupación y de detección—, que son datos cargados por el
    # usuario y no parte del esquema. Un downgrade no debería destruirlos.
    #
    # Nada queda colgando por esto: el downgrade de la revisión inicial (e72cc6e493dc)
    # dropea la tabla entera, así que al desandar hasta el principio la fila se va con ella.
    pass
