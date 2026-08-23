# Punto de entrada de Alembic (T26-137).
#
# Alembic vive en database/ y no en backend/, siguiendo la carpeta que ya eligió
# T26-136 para los cambios de esquema. A cambio hay que meter backend/ en
# sys.path a mano para poder importar los modelos, con el mismo idioma que usan
# los otros scripts del repo (ver database/historico/migrar_credenciales_camaras.py).

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

RAIZ_BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(RAIZ_BACKEND))

load_dotenv(RAIZ_BACKEND / ".env")

from app.database import Base  # noqa: E402

# Importar los modelos es lo que los registra en Base.metadata; sin esto,
# --autogenerate no vería ninguna tabla y propondría borrarlas todas.
from app.models import (  # noqa: E402,F401
    camara,
    configuracion,
    historial,
    mesa,
    roi_mesa,
    sector,
    user,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

if not os.getenv("DATABASE_URL"):
    raise SystemExit(
        "Falta DATABASE_URL en backend/.env: Alembic no sabe contra qué base correr.\n"
        "Ver database/README.md."
    )

# La URL se inyecta acá y no en alembic.ini, que se versiona.
#
# El `%` se duplica porque set_main_option pasa el valor por la interpolación de
# configparser, que lee `%` como el arranque de una variable y revienta con
# «invalid interpolation syntax». Pasa con cualquier URL que traiga algo
# percent-encoded, que es lo normal si la contraseña tiene caracteres especiales.
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"].replace("%", "%%"))

target_metadata = Base.metadata

# compare_type y compare_server_default son el motivo por el que este ticket
# existe: sin ellos, --autogenerate ignora que una columna cambió de tipo o que
# la base tiene un DEFAULT que el modelo no declara, que es exactamente el drift
# silencioso que T26-137 vino a cerrar.
OPCIONES_COMPARACION = {
    "compare_type": True,
    "compare_server_default": True,
}


def run_migrations_offline() -> None:
    """Genera el SQL sin conectarse, para revisarlo o pasárselo a psql."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **OPCIONES_COMPARACION,
    )

    with context.begin_transaction():
        context.run_migrations()


def _ejecutar(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Normalmente None (la tabla va donde apunte la conexión). Se fija sólo
        # al migrar sobre un schema aparte: Alembic NO pasa su tabla de versiones
        # por el schema_translate_map, así que sin esto leería la de producción,
        # se creería en head y no correría ninguna migración.
        version_table_schema=config.attributes.get("version_table_schema"),
        **OPCIONES_COMPARACION,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Si quien invoca ya trae una conexión abierta, se usa esa. Es el patrón que
    # documenta Alembic para llamarlo desde Python en vez de la CLI, y es lo que
    # permite correr las migraciones sobre un schema aparte —con el search_path
    # ya puesto en esa conexión— sin tocar producción. Lo usa
    # backend/scripts/verificar_esquema_versionado.py.
    conexion_externa = config.attributes.get("connection")
    if conexion_externa is not None:
        _ejecutar(conexion_externa)
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        _ejecutar(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
