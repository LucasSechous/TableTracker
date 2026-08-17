# Qué estado escribe el módulo de visión, según lo que ve y cómo está la mesa.
#
# La cámara solo sabe si hay o no hay gente sobre la mesa. Los cuatro estados
# del backend no se deducen de eso: `reservada` la pone recepción y
# `pendiente_limpieza` se salda cuando el personal marca la mesa como limpia.
# Este módulo es el único lugar donde se decide cómo se cruzan las dos cosas.
#
#   Observación   Estado actual         Escribe               Por qué
#   ------------- --------------------- --------------------- --------------------------------
#   hay gente     libre                 ocupada               llegaron comensales
#   hay gente     reservada             ocupada               llegó quien había reservado
#   hay gente     ocupada               —                     ya está
#   hay gente     pendiente_limpieza    —                     lo más probable es que sea el
#                                                             personal limpiando; marcarla
#                                                             ocupada borraría la tarea abierta
#   vacía         ocupada               pendiente_limpieza    se fueron: hay que levantarla
#   vacía         libre                 —                     ya está
#   vacía         reservada             —                     la reserva la gestiona recepción
#   vacía         pendiente_limpieza    —                     la libera el personal de limpieza
#
# De ahí que el módulo nunca escriba `libre`: una mesa vuelve a estar libre
# cuando alguien la limpia (`PATCH /mesas/{id}/limpieza`), no cuando se vacía.

LIBRE = "libre"
OCUPADA = "ocupada"
PENDIENTE_LIMPIEZA = "pendiente_limpieza"
RESERVADA = "reservada"

# Estados sobre los que el módulo puede escribir al confirmar que hay gente y al
# confirmar que la mesa quedó vacía. Los que no figuran se dejan como están.
_AL_OCUPARSE = {LIBRE: OCUPADA, RESERVADA: OCUPADA}
_AL_VACIARSE = {OCUPADA: PENDIENTE_LIMPIEZA}


def estado_objetivo(hay_gente, estado_actual):
    """Devuelve el estado a escribir, o None si la mesa se deja como está."""
    transiciones = _AL_OCUPARSE if hay_gente else _AL_VACIARSE
    return transiciones.get(estado_actual)
