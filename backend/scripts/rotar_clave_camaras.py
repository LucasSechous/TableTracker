# Rota la clave con la que se cifran las contraseñas RTSP (T26-136).
#
# El procedimiento completo, en orden:
#
#   1. Generá la clave nueva:
#        python scripts/rotar_clave_camaras.py --generar-clave
#   2. Ponela PRIMERA en backend/.env, dejando la vieja detrás:
#        CAMARA_ENCRYPTION_KEYS=<nueva>,<vieja>
#      A partir de acá la API cifra con la nueva y sigue leyendo lo viejo, así que
#      no hay ventana en la que las cámaras dejen de funcionar.
#   3. Recifrá las filas existentes:
#        python scripts/rotar_clave_camaras.py
#   4. Sacá la clave vieja del .env y reiniciá el backend:
#        CAMARA_ENCRYPTION_KEYS=<nueva>
#
# Si te salteás el paso 3 y hacés el 4, las contraseñas guardadas dejan de abrir:
# test-conexion y snapshot devuelven un 500 explicando justamente eso. Se arregla
# volviendo a poner la clave vieja al final de la lista y corriendo el paso 3.
#
# Uso (desde backend/, con el venv activado).

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import cifrado  # noqa: E402

load_dotenv()

LEER = text("SELECT id, nombre, password_cifrada FROM camaras WHERE password_cifrada IS NOT NULL ORDER BY id")
ESCRIBIR = text("UPDATE camaras SET password_cifrada = :token WHERE id = :id")


def main() -> None:
    parser = argparse.ArgumentParser(description="Recifra las contraseñas de cámaras con la clave activa")
    parser.add_argument("--generar-clave", action="store_true", help="Imprime una clave nueva y termina")
    parser.add_argument("--dry-run", action="store_true", help="No escribe: solo verifica que todo abre")
    args = parser.parse_args()

    if args.generar_clave:
        print(cifrado.generar_clave())
        return

    if not os.getenv("DATABASE_URL"):
        sys.exit("Falta DATABASE_URL en backend/.env")

    motor = create_engine(os.environ["DATABASE_URL"])
    # Transacción explícita: acá sí queremos todo o nada —una tabla con la mitad
    # de las filas en una clave y la mitad en otra es peor que no rotar— pero el
    # rollback se hace a mano y no dependiendo de que SystemExit propague por un
    # motor.begin(), que es un acoplamiento fácil de romper sin darse cuenta.
    with motor.connect() as conexion:
        filas = conexion.execute(LEER).all()
        if not filas:
            print("No hay contraseñas guardadas para recifrar.")
            return

        print(f"{len(filas)} contraseña(s) a recifrar:\n")
        for id_camara, nombre, token in filas:
            try:
                # recifrar() descifra con cualquiera de las claves de la lista y
                # vuelve a cifrar siempre con la primera, que es la activa.
                nuevo = cifrado.recifrar(token)
            except (cifrado.NoSePudoDescifrar, cifrado.ClaveNoConfigurada) as error:
                conexion.rollback()
                sys.exit(f"\nid={id_camara} {nombre!r}: {error}\n\nNo se escribió nada.")

            if not args.dry_run:
                conexion.execute(ESCRIBIR, {"id": id_camara, "token": nuevo})
            print(f"  id={id_camara:<4} {nombre!r}: ok")

        if args.dry_run:
            conexion.rollback()
            print("\n[--dry-run] Todas abren con las claves configuradas. No se escribió nada.")
        else:
            conexion.commit()
            print("\nListo. Ya podés sacar la clave vieja de CAMARA_ENCRYPTION_KEYS y reiniciar el backend.")


if __name__ == "__main__":
    main()
