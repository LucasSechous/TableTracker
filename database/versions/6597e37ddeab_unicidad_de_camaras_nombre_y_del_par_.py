"""unicidad de camaras.nombre y del par mesa+camara en roi_mesa

Revision ID: 6597e37ddeab
Revises: 903cf408bb66
Create Date: 2026-08-23

Le da respaldo del motor a dos reglas que hasta acá vivían sólo en los routers
(T26-141).

`camaras.nombre` y el par (`mesa_id`, `camara_id`) de `roi_mesa` se controlaban
consultando antes de insertar y devolviendo un 409 a mano. Alcanza para el uso
normal, pero no para dos altas simultáneas: las dos consultas pueden no ver nada,
las dos inserciones pasar, y quedan duplicados que después hay que deshacer a
mano. El UNIQUE cierra esa ventana.

Las dos constraints aplican a la fila esté activa o no, que es lo que los routers
ya asumían: el de cámaras avisa «puede estar inactiva» en su 409, y el de ROIs
depende de que un par dado de baja siga ocupando su lugar para poder reutilizar
la fila al volver a darlo de alta en vez de duplicarla. Que una misma mesa tenga
ROI en varias cámaras distintas sigue siendo válido — el UNIQUE es sobre el par.

Duplicados previos: no se limpian solos. Si los hubiera, `upgrade()` corta antes
de tocar nada y los lista. Elegir qué fila sobrevive —qué cámara se renombra, qué
polígono se conserva— no es una decisión que una migración pueda tomar por su
cuenta sin borrar el trabajo de alguien.

Estado en Supabase: las dos constraints YA están, con estos mismos nombres. Se
aplicaron a mano antes de que esta revisión existiera, así que producción se pone
al día con `alembic stamp 6597e37ddeab`, que sólo anota la versión sin correr
DDL (ya se hizo, igual que con la revisión inicial). Correr el upgrade ahí falla
con «already exists», y está bien que falle: querría decir que la base no es la
que esta revisión cree.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "6597e37ddeab"
down_revision: Union[str, Sequence[str], None] = "903cf408bb66"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (tabla, nombre de la constraint, columnas). Los nombres se fijan a mano —y se
# repiten igual en los modelos— porque son los que Supabase ya tiene: dejar que
# Postgres los invente daría `camaras_nombre_key` y la base no coincidiría con lo
# que produce esta revisión.
UNICIDAD = [
    ("camaras", "camaras_nombre_unique", ["nombre"]),
    ("roi_mesa", "roi_mesa_mesa_camara_unique", ["mesa_id", "camara_id"]),
]


def _repetidos(tabla: str, columnas: list[str]) -> list[tuple]:
    """Valores que aparecen más de una vez, con cuántas filas los usan.

    Va por `sa.Table` y no por `sa.text`: el texto crudo se manda tal cual y se
    resolvería contra el search_path —o sea `public`— aunque la migración esté
    corriendo sobre otro schema. Un `Table` sin schema pasa por el
    schema_translate_map de la conexión y consulta el que se está migrando, que
    es lo que hace falta para que esto valga algo desde
    backend/scripts/verificar_esquema_versionado.py.
    """
    columnas_sql = [sa.Column(nombre) for nombre in columnas]
    tabla_sql = sa.Table(tabla, sa.MetaData(), *columnas_sql)
    consulta = (
        sa.select(*columnas_sql, sa.func.count().label("filas"))
        .group_by(*columnas_sql)
        .having(sa.func.count() > 1)
        .order_by(*columnas_sql)
    )
    return [tuple(fila) for fila in op.get_bind().execute(consulta)]


def upgrade() -> None:
    # Las dos tablas se revisan antes de tocar ninguna: si `roi_mesa` tuviera
    # duplicados, no tiene sentido haber agregado ya la constraint de `camaras`
    # y dejar la migración a medio aplicar.
    for tabla, nombre, columnas in UNICIDAD:
        repetidos = _repetidos(tabla, columnas)
        if repetidos:
            detalle = "\n".join(
                f"  ({', '.join(columnas)}) = {fila[:-1]} en {fila[-1]} filas" for fila in repetidos
            )
            raise RuntimeError(
                f"No se puede agregar {nombre}: {tabla} ya tiene valores repetidos.\n"
                f"{detalle}\n"
                "Resolvé a mano qué fila queda en cada caso y volvé a correr el upgrade."
            )

    for tabla, nombre, columnas in UNICIDAD:
        op.create_unique_constraint(nombre, tabla, columnas)


def downgrade() -> None:
    for tabla, nombre, _ in reversed(UNICIDAD):
        op.drop_constraint(nombre, tabla, type_="unique")
