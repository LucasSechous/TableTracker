"""estado inicial del esquema

Revision ID: e72cc6e493dc
Revises:
Create Date: 2026-08-23

Retrato del esquema tal como está HOY en Supabase (T26-137).

Hasta acá el esquema se venía aplicando a mano y nunca entró al repo: `camaras` y
`roi_mesa` las creó T26-125 con DDL suelto, y el resto nació de
`Base.metadata.create_all`. Esta revisión lo captura para que exista un punto de
partida reproducible.

IMPORTANTE — esta revisión refleja la base REAL, no los modelos. Hay dos lugares
donde eso se nota y son a propósito:

  - `camaras` y `roi_mesa` NO llevan el índice `ix_camaras_id` / `ix_roi_mesa_id`
    que los modelos declaran con `index=True`. Supabase no los tiene: son
    justamente las dos tablas que se crearon a mano. Los agrega la revisión
    siguiente.
  - El CHECK de `configuracion_general` se llama `configuracion_general_singleton`,
    que es su nombre real en la base.

Cómo se aplica:

  - Sobre la base que YA existe (Supabase): `alembic stamp e72cc6e493dc`. Sólo
    anota la versión, no corre una sola sentencia DDL.
  - Sobre una base vacía: `alembic upgrade head`, que la deja idéntica a producción.

Correr el upgrade contra una base que ya tiene las tablas falla, y está bien que
falle: significa que alguien se salteó el stamp.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e72cc6e493dc"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# El tipo se crea una sola vez, aparte de las tablas: lo usan `mesas` y
# `historial_estados`, y si cada create_table intentara crearlo la segunda
# fallaría con «type already exists».
ESTADO_MESA = postgresql.ENUM(
    "libre",
    "ocupada",
    "pendiente_limpieza",
    "reservada",
    name="estadomesa",
    create_type=False,
)


def upgrade() -> None:
    ESTADO_MESA.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "sectores",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nombre", sa.String(), nullable=False),
        sa.Column("descripcion", sa.String(), nullable=True),
        sa.Column("activo", sa.Boolean(), nullable=True),
        sa.Column("pos_x", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("pos_y", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("ancho", sa.Integer(), server_default=sa.text("400"), nullable=False),
        sa.Column("alto", sa.Integer(), server_default=sa.text("300"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="sectores_pkey"),
        sa.UniqueConstraint("nombre", name="sectores_nombre_key"),
    )
    op.create_index("ix_sectores_id", "sectores", ["id"])

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nombre", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password", sa.String(), nullable=False),
        sa.Column("rol", sa.String(), nullable=False),
        sa.Column("activo", sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="users_pkey"),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "configuracion_general",
        # Sin secuencia a propósito: es una fila única, y el CHECK la fuerza a
        # id=1. Por eso `autoincrement=False` — con SERIAL, Alembic crearía una
        # secuencia que la base real no tiene.
        sa.Column("id", sa.Integer(), autoincrement=False, server_default=sa.text("1"), nullable=False),
        sa.Column("nombre_establecimiento", sa.String(), nullable=True),
        sa.Column("ancho_salon", sa.Integer(), server_default=sa.text("1200"), nullable=False),
        sa.Column("alto_salon", sa.Integer(), server_default=sa.text("700"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id", name="configuracion_general_pkey"),
        sa.CheckConstraint("id = 1", name="configuracion_general_singleton"),
    )

    op.create_table(
        "mesas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("sector_id", sa.Integer(), nullable=False),
        sa.Column("estado", ESTADO_MESA, nullable=False),
        sa.Column("activa", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("pos_x", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("pos_y", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="mesas_pkey"),
        sa.ForeignKeyConstraint(["sector_id"], ["sectores.id"], name="mesas_sector_id_fkey"),
        sa.UniqueConstraint("numero", "sector_id", name="uq_mesa_numero_sector"),
    )
    op.create_index("ix_mesas_id", "mesas", ["id"])

    # El orden de las columnas es el real: `esquema`..`password_cifrada` van al
    # final porque T26-136 las agregó con ALTER TABLE sobre la tabla existente.
    op.create_table(
        "camaras",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nombre", sa.String(), nullable=False),
        sa.Column("sector_id", sa.Integer(), nullable=False),
        sa.Column("activa", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("esquema", sa.String(), server_default=sa.text("'rtsp'::character varying"), nullable=False),
        sa.Column("host", sa.String(), nullable=False),
        sa.Column("puerto", sa.Integer(), server_default=sa.text("554"), nullable=False),
        sa.Column("ruta", sa.String(), server_default=sa.text("'/'::character varying"), nullable=False),
        sa.Column("usuario", sa.String(), nullable=True),
        sa.Column("password_cifrada", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="camaras_pkey"),
        sa.ForeignKeyConstraint(["sector_id"], ["sectores.id"], name="camaras_sector_id_fkey"),
    )
    # Sin ix_camaras_id: la base no lo tiene. Lo agrega la revisión siguiente.

    op.create_table(
        "roi_mesa",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mesa_id", sa.Integer(), nullable=False),
        sa.Column("camara_id", sa.Integer(), nullable=False),
        sa.Column("coordenadas", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("activa", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id", name="roi_mesa_pkey"),
        sa.ForeignKeyConstraint(["mesa_id"], ["mesas.id"], name="roi_mesa_mesa_id_fkey"),
        sa.ForeignKeyConstraint(["camara_id"], ["camaras.id"], name="roi_mesa_camara_id_fkey"),
    )
    # Sin ix_roi_mesa_id, por el mismo motivo que camaras.

    op.create_table(
        "historial_estados",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mesa_id", sa.Integer(), nullable=False),
        sa.Column("estado", ESTADO_MESA, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id", name="historial_estados_pkey"),
        sa.ForeignKeyConstraint(["mesa_id"], ["mesas.id"], name="historial_estados_mesa_id_fkey"),
    )
    op.create_index("ix_historial_estados_id", "historial_estados", ["id"])


def downgrade() -> None:
    # Orden inverso al de creación: primero las que apuntan a otras.
    op.drop_index("ix_historial_estados_id", table_name="historial_estados")
    op.drop_table("historial_estados")
    op.drop_table("roi_mesa")
    op.drop_table("camaras")
    op.drop_index("ix_mesas_id", table_name="mesas")
    op.drop_table("mesas")
    op.drop_table("configuracion_general")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")
    op.drop_index("ix_sectores_id", table_name="sectores")
    op.drop_table("sectores")
    ESTADO_MESA.drop(op.get_bind(), checkfirst=True)
