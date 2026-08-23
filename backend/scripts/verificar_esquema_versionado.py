# Verificación de T26-137: las migraciones reproducen el esquema real.
#
# La pregunta que contesta es la que motivó el ticket: ¿un entorno nuevo levanta
# con el MISMO esquema que producción? Antes no había forma de saberlo, porque el
# esquema se creaba con `Base.metadata.create_all` y nadie lo comparaba con nada.
#
# Cómo lo prueba, sin tocar producción:
#
#   1. Crea un schema descartable en la misma base.
#   2. Corre `alembic upgrade head` dentro de ese schema, desde cero.
#   3. Compara columna por columna, constraint por constraint e índice por índice
#      contra `public`, que es el esquema real de producción.
#   4. Borra el schema descartable, pase lo que pase.
#
# Se corre a mano, como los otros scripts de verificación del repo, e imprime
# cada chequeo terminando con código 1 si alguno falla.
#
# Uso (desde backend/, con el venv activado):
#   python scripts/verificar_esquema_versionado.py

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
RAIZ_REPO = RAIZ_BACKEND.parent
sys.path.insert(0, str(RAIZ_BACKEND))

load_dotenv(RAIZ_BACKEND / ".env")

SCHEMA_PRUEBA = "verif_t26_137"
ALEMBIC_INI = RAIZ_REPO / "database" / "alembic.ini"

_fallos = []
_total = 0


def check(descripcion, condicion, detalle=""):
    global _total
    _total += 1
    if condicion:
        print(f"  ok   {descripcion}")
    else:
        print(f"  FALLA {descripcion}" + (f" - {detalle}" if detalle else ""))
        _fallos.append(descripcion)


# --------------------------------------------------------------- relevamiento
COLUMNAS = text("""
    SELECT table_name, column_name, data_type, is_nullable, column_default, udt_name
    FROM information_schema.columns WHERE table_schema = :s
    ORDER BY table_name, column_name
""")

CONSTRAINTS = text("""
    SELECT rel.relname, con.conname, con.contype, pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = :s
    ORDER BY rel.relname, con.conname
""")

INDICES = text("""
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = :s ORDER BY tablename, indexname
""")

ENUMS = text("""
    SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = :s
    GROUP BY t.typname ORDER BY t.typname
""")


# alembic_version es la bitácora del propio Alembic, no parte del esquema de la
# aplicación. Vive en el schema que se esté migrando, así que aparecería siempre
# como diferencia y no significa nada.
TABLAS_IGNORADAS = {"alembic_version"}


def relevar(conexion, schema):
    """Estructura del schema, normalizada para poder compararla.

    La normalización saca el nombre del schema de adentro de las definiciones:
    Postgres las califica («REFERENCES public.sectores(id)»,
    «nextval('public.mesas_id_seq')»), y el schema es justamente lo único que
    tiene que diferir entre los dos lados. Se saca de ambos para que la
    comparación mire la estructura y no dónde está guardada.
    """
    def limpiar(valor):
        if not isinstance(valor, str):
            return valor
        return valor.replace(f"{schema}.", "").replace(f"'{schema}.", "'")

    def filas(consulta):
        return {
            tuple(limpiar(v) for v in fila)
            for fila in conexion.execute(consulta, {"s": schema})
            if fila[0] not in TABLAS_IGNORADAS
        }

    return {
        "columnas": filas(COLUMNAS),
        "constraints": filas(CONSTRAINTS),
        "indices": filas(INDICES),
        "enums": filas(ENUMS),
    }


def informar_diferencias(nombre, esperado, obtenido):
    """`esperado` es producción (public); `obtenido`, el schema recién migrado."""
    faltan = esperado - obtenido
    sobran = obtenido - esperado
    check(f"{nombre}: coinciden con producción", not faltan and not sobran)
    for f in sorted(faltan):
        print(f"       FALTA en el entorno nuevo: {f}")
    for s in sorted(sobran):
        print(f"       SOBRA en el entorno nuevo: {s}")


def main():
    if not os.getenv("DATABASE_URL"):
        sys.exit("Falta DATABASE_URL en backend/.env")

    motor = create_engine(os.environ["DATABASE_URL"], isolation_level="AUTOCOMMIT")

    print(f"\n[1] Migrando desde cero sobre el schema {SCHEMA_PRUEBA}")
    try:
        with motor.connect() as bruta:
            bruta.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA_PRUEBA} CASCADE"))
            bruta.execute(text(f"CREATE SCHEMA {SCHEMA_PRUEBA}"))

            # schema_translate_map y NO «SET search_path»: el search_path es
            # estado de sesión, y Supabase atiende por un pooler en modo
            # transacción que reutiliza las conexiones de servidor entre
            # clientes, así que el SET se filtra al que le toque después y lo
            # deja apuntando a un schema que este script borra al terminar
            # (pasó, y rompe toda conexión posterior con «no schema has been
            # selected to create in»). El translate map hace lo mismo en la
            # compilación del DDL, sin tocar la sesión.
            conexion = bruta.execution_options(
                schema_translate_map={None: SCHEMA_PRUEBA}
            )

            cfg = Config(str(ALEMBIC_INI))
            cfg.attributes["connection"] = conexion
            cfg.attributes["version_table_schema"] = SCHEMA_PRUEBA
            command.upgrade(cfg, "head")
            print("  ok   upgrade head corrió sobre un schema vacío")

            version = bruta.execute(
                text(f"SELECT version_num FROM {SCHEMA_PRUEBA}.alembic_version")
            ).scalar()
            print(f"  ok   quedó en la revisión {version}")

            print("\n[2] Comparando contra producción (public)")
            # El relevamiento va por `bruta`: son consultas a information_schema
            # y pg_catalog con el schema como parámetro, nada que traducir.
            produccion = relevar(bruta, "public")
            nuevo = relevar(bruta, SCHEMA_PRUEBA)

            for clave, etiqueta in [
                ("enums", "Tipos enum"),
                ("columnas", "Columnas"),
                ("constraints", "Constraints"),
                ("indices", "Índices"),
            ]:
                informar_diferencias(etiqueta, produccion[clave], nuevo[clave])
    finally:
        with motor.connect() as conexion:
            conexion.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA_PRUEBA} CASCADE"))
            print(f"\n  (schema {SCHEMA_PRUEBA} eliminado)")

    print(f"\n{'=' * 60}")
    if _fallos:
        print(f"{len(_fallos)} de {_total} chequeos FALLARON:")
        for f in _fallos:
            print(f"  - {f}")
        sys.exit(1)
    print(f"Los {_total} chequeos pasaron: un entorno nuevo nace idéntico a producción.")


if __name__ == "__main__":
    main()
