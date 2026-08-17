# Umbral de tiempo sostenido antes de confirmar un cambio de estado.
#
# La lectura frame a frame es ruidosa: un mozo que pasa al lado de la mesa, una
# silla que tapa medio segundo a quien está sentado, o un frame en el que YOLO
# no llega al umbral de confianza. Escribir en el backend cada oscilación
# llenaría el historial de estados de basura y haría parpadear el tablero.
#
# Por eso una observación tiene que repetirse durante CONFIRMACION_SEGUNDOS
# seguidos antes de valer como cambio: si se corta antes, el reloj vuelve a
# cero y el estado confirmado no se toca.

from app.utils.logger import get_logger

logger = get_logger(__name__)


class Confirmador:
    def __init__(self, segundos):
        self.segundos = segundos
        # mesa_id -> (valor observado, instante en que empezó a observarse)
        self._observado = {}
        # mesa_id -> último valor confirmado, o ausente si todavía no se confirmó
        # ninguno. Arrancar sin valor y no en "libre" es a propósito: al levantar
        # el módulo no se sabe nada de la mesa, y suponerlo llevaría a escribir
        # un cambio inventado apenas se confirma la primera lectura.
        self._confirmado = {}

    def actualizar(self, ocupacion, ahora):
        """Registra la lectura de un frame y devuelve {mesa_id: bool} con los cambios confirmados.

        `ocupacion` es {mesa_id: bool} tal como lo devuelve zonas.resolver_ocupacion,
        y `ahora` un instante monótono en segundos. Solo salen las mesas cuyo
        estado confirmado cambió en esta llamada; un frame sin novedades devuelve
        un diccionario vacío.
        """
        cambios = {}
        for mesa_id, valor in ocupacion.items():
            anterior = self._observado.get(mesa_id)
            if anterior is None or anterior[0] != valor:
                # Observación nueva (o distinta de la que venía): arranca el reloj.
                self._observado[mesa_id] = (valor, ahora)
                continue

            sostenido = ahora - anterior[1]
            if valor != self._confirmado.get(mesa_id) and sostenido >= self.segundos:
                self._confirmado[mesa_id] = valor
                cambios[mesa_id] = valor
                logger.info(
                    "Mesa %s: %s confirmado tras %.1fs sostenidos",
                    mesa_id,
                    "ocupada" if valor else "vacía",
                    sostenido,
                )
        return cambios

    def revertir(self, mesa_id):
        # El cambio se confirmó pero no se pudo escribir en el backend. Se borra
        # la confirmación para que el próximo frame la vuelva a emitir y
        # reintente: la observación sigue sostenida, así que sale de inmediato.
        self._confirmado.pop(mesa_id, None)

    def olvidar(self, mesas_vigentes):
        # Un ROI dado de baja deja de llegar en la lectura; se limpia su rastro
        # para que si vuelve a darse de alta arranque sin valor confirmado, como
        # cualquier mesa nueva, en vez de con lo que se había visto hace horas.
        for registro in (self._observado, self._confirmado):
            for mesa_id in set(registro) - set(mesas_vigentes):
                del registro[mesa_id]
