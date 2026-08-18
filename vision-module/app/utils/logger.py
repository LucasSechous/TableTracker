# Logging del módulo de visión.
# Todos los componentes usan get_logger para escribir con el mismo formato y nivel.

import logging
from app import config

_configurado = False


def get_logger(nombre):
    global _configurado
    if not _configurado:
        logging.basicConfig(
            level=config.LOG_LEVEL,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        )
        _configurado = True
    return logging.getLogger(nombre)
