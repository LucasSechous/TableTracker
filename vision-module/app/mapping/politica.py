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
#   hay gente     reservada             ocupada  /  CONFIRMAR  depende de la hora, ver abajo
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
#
# Sobre `reservada` + hay gente (T26-208)
#
# Antes esto era siempre `ocupada`, con el comentario «llegó quien había
# reservado». Es un supuesto, y falla en un caso concreto: alguien se sienta sin
# ver que la mesa está reservada y al rato se va. Marcarla ocupada borra la
# reserva de la pantalla justo antes de que lleguen los que sí reservaron.
#
# Lo que distingue un caso del otro es la HORA. Si la gente se sienta cerca de la
# hora reservada, casi seguro son ellos y no hay nada que preguntar. Si se sienta
# mucho antes o mucho después, es dudoso y lo resuelve una persona.
#
# Por eso la ventana y no una confirmación siempre: si cada detección sobre una
# mesa reservada pidiera permiso, el salón mostraría «reservada» con gente
# sentada todo el tiempo que nadie mire la pantalla, que es PEOR que equivocarse
# rápido y corregirse solo. La ventana deja la pregunta únicamente para cuando de
# verdad hay algo que decidir.
#
# Una reserva SIN hora se comporta como antes —`ocupada` directo—: sin hora no hay
# con qué juzgar, y negarse a ocupar la mesa por falta de un dato que el sistema
# no pedía hasta ayer sería peor que el supuesto viejo.

from datetime import datetime, timezone

# Lo que devuelve la política cuando hay gente en una mesa reservada y la hora no
# respalda que sean los de la reserva. NO es un estado del backend: es la señal de
# que la mesa se deja como está y alguien tiene que decidir. El prefijo con guiones
# bajos es para que no pueda confundirse con un estado si alguien lo imprime.
CONFIRMAR = "__confirmar__"

LIBRE = "libre"
OCUPADA = "ocupada"
PENDIENTE_LIMPIEZA = "pendiente_limpieza"
RESERVADA = "reservada"

# Estados sobre los que el módulo puede escribir al confirmar que hay gente y al
# confirmar que la mesa quedó vacía. Los que no figuran se dejan como están.
_AL_OCUPARSE = {LIBRE: OCUPADA, RESERVADA: OCUPADA}
_AL_VACIARSE = {OCUPADA: PENDIENTE_LIMPIEZA}


def estado_objetivo(hay_gente, estado_actual, reservada_para=None, ahora=None,
                    tolerancia_minutos=0):
    """Devuelve el estado a escribir, CONFIRMAR, o None si la mesa se deja como está.

    `reservada_para` es el momento para el que está reservada la mesa, o None si se
    reservó sin decir hora. Los tres parámetros nuevos son opcionales y con ellos en
    su valor por defecto la función se comporta exactamente como antes de T26-208,
    que es lo que corresponde cuando no hay hora contra la cual juzgar.
    """
    transiciones = _AL_OCUPARSE if hay_gente else _AL_VACIARSE
    objetivo = transiciones.get(estado_actual)

    if objetivo == OCUPADA and estado_actual == RESERVADA and reservada_para is not None:
        if not _dentro_de_la_ventana(reservada_para, ahora, tolerancia_minutos):
            return CONFIRMAR

    return objetivo


def _dentro_de_la_ventana(reservada_para, ahora, tolerancia_minutos):
    """Si `ahora` cae dentro de ±tolerancia alrededor de la hora reservada."""
    ahora = ahora or datetime.now(timezone.utc)
    # Las dos puntas tienen que ser comparables: el backend manda la hora con zona y
    # un `ahora` ingenuo haría estallar la resta con un TypeError en pleno ciclo.
    if reservada_para.tzinfo is None:
        reservada_para = reservada_para.replace(tzinfo=timezone.utc)
    if ahora.tzinfo is None:
        ahora = ahora.replace(tzinfo=timezone.utc)
    return abs((ahora - reservada_para).total_seconds()) <= tolerancia_minutos * 60
