# T26-136 — fase 2: llena las columnas nuevas de `camaras` a partir de rtsp_url.
#
# Lee cada fila, parsea la URL con el mismo app.services.rtsp que usa la API
# (para que la migración no interprete las URLs distinto que el código que después
# las va a usar), y escribe esquema/host/puerto/ruta/usuario más la contraseña
# cifrada con app.services.cifrado.
#
# Es idempotente: las filas que ya tienen `host` se saltean, así que se puede
# volver a correr si quedó a medias. No toca `rtsp_url` — de eso se encarga 002,
# después de que verifiques que la app anda.
#
# NO imprime contraseñas ni las escribe a disco en ningún momento. Tampoco deja
# un backup de la columna en claro: ese archivo sería el problema que este ticket
# viene a resolver. El backup, si lo querés, tomalo desde Supabase.
#
# Uso (desde la raíz del repo, con el venv del backend activado y
# CAMARA_ENCRYPTION_KEYS ya cargada en backend/.env):
#
#   python database/migrar_credenciales_camaras.py --dry-run   # muestra qué haría
#   python database/migrar_credenciales_camaras.py             # escribe

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

RAIZ_BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(RAIZ_BACKEND))

from app.services import cifrado, rtsp  # noqa: E402

load_dotenv(RAIZ_BACKEND / ".env")

LEER = text(
    "SELECT id, nombre, rtsp_url FROM camaras WHERE host IS NULL AND rtsp_url IS NOT NULL ORDER BY id"
)
ESCRIBIR = text(
    """
    UPDATE camaras
       SET esquema = :esquema,
           host = :host,
           puerto = :puerto,
           ruta = :ruta,
           usuario = :usuario,
           password_cifrada = :password_cifrada
     WHERE id = :id
    """
)


def _comprobar_entorno() -> None:
    if not os.getenv("DATABASE_URL"):
        sys.exit("Falta DATABASE_URL en backend/.env")
    try:
        # Falla temprano y con un mensaje entendible si la clave no está o no
        # sirve, en vez de a mitad de la migración con media tabla escrita.
        cifrado.cifrar("prueba")
    except cifrado.ClaveNoConfigurada as error:
        sys.exit(str(error))


def main() -> None:
    parser = argparse.ArgumentParser(description="Migra camaras.rtsp_url a columnas separadas (T26-136)")
    parser.add_argument("--dry-run", action="store_true", help="No escribe: solo muestra qué haría")
    args = parser.parse_args()

    _comprobar_entorno()
    motor = create_engine(os.environ["DATABASE_URL"])

    # Transacción explícita y no motor.begin(): begin() revierte ante cualquier
    # excepción, y SystemExit es una excepción. Con begin(), el sys.exit(1) del
    # final —el que avisa que quedaron filas rotas— descartaba también las filas
    # que sí se habían migrado bien, y la migración no escribía nada nunca.
    with motor.connect() as conexion:
        pendientes = conexion.execute(LEER).all()
        if not pendientes:
            total = conexion.execute(text("SELECT count(*) FROM camaras")).scalar()
            print(f"No hay filas pendientes ({total} cámara(s) en total). ¿Ya se corrió?")
            return

        print(f"{len(pendientes)} cámara(s) a migrar:\n")
        migradas, fallidas = 0, []
        for id_camara, nombre, url in pendientes:
            try:
                partes = rtsp.parsear_url(url)
            except ValueError as error:
                # Una URL rota no frena al resto: se informa y se deja sin migrar,
                # con lo cual 002 va a abortar hasta que alguien la arregle a mano.
                fallidas.append((id_camara, nombre, str(error)))
                print(f"  id={id_camara:<4} {nombre!r}: NO SE PUDO PARSEAR ({error})")
                continue

            if not args.dry_run:
                conexion.execute(
                    ESCRIBIR,
                    {
                        "id": id_camara,
                        "esquema": partes.esquema,
                        "host": partes.host,
                        "puerto": partes.puerto,
                        "ruta": partes.ruta,
                        "usuario": partes.usuario,
                        "password_cifrada": cifrado.cifrar(partes.password),
                    },
                )
            migradas += 1
            # Sin caracteres fuera de cp1252 (nada de flechas): la consola de
            # Windows usa esa codificación por defecto y un print con «→» aborta
            # la migración a mitad de camino con un UnicodeEncodeError.
            print(
                f"  id={id_camara:<4} {rtsp.enmascarar_url(url):<55} "
                f"-> {partes.esquema}://{partes.host}:{partes.puerto}{partes.ruta} "
                f"usuario={partes.usuario or '(ninguno)'} "
                f"password={'cifrada' if partes.password else '(ninguna)'}"
            )

        if args.dry_run:
            conexion.rollback()
            print(f"\n[--dry-run] No se escribió nada. Se migrarían {migradas} fila(s).")
        else:
            # Las filas buenas se guardan aunque alguna haya fallado: 002 no deja
            # borrar rtsp_url mientras quede una sin migrar, así que quedarse a
            # mitad de camino es un estado seguro, y volver a correr el script
            # retoma solo lo que falta.
            conexion.commit()
            print(f"\nListo: {migradas} fila(s) migrada(s).")

    if fallidas:
        print(f"\n{len(fallidas)} fila(s) quedaron sin migrar y hay que arreglarlas a mano:")
        for id_camara, nombre, error in fallidas:
            print(f"  id={id_camara} {nombre!r}: {error}")
        print("Arreglá esas URLs y volvé a correr el script. 002 no va a dejar borrar rtsp_url hasta entonces.")
        sys.exit(1)

    if not args.dry_run:
        print("Verificá que la app anda (listar, test-conexion, snapshot) y después corré 002.")


if __name__ == "__main__":
    main()
