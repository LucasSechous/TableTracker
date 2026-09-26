# Estado dudoso de una mesa: posible error de detección (T26-188, RF-27).
#
# Una mesa está en "estado dudoso" cuando su estado quedó colgado de una forma que la
# detección automática, funcionando bien, no debería haber dejado pasar. El criterio se
# eligió con la inspección de la Fase 1 y son tres condiciones simultáneas:
#
#   1. la mesa está en 'ocupada';
#   2. tiene ROI activo en una cámara activa;
#   3. el momento es FUERA del horario de servicio.
#
# Por qué SOLO 'ocupada'. La política de vision-module (vision-module/app/mapping/
# politica.py) escribe en 2 de las 8 combinaciones de (observación, estado); en las otras 6
# no tocar la mesa es el comportamiento correcto. Una mesa 'libre' y vacía no se actualiza
# nunca —es el estado normal de casi todo el salón, casi todo el tiempo—, 'reservada' la
# gestiona recepción y 'pendiente_limpieza' la libera el personal. 'ocupada' es el único
# estado donde la política GARANTIZA que un detector sano tiene que actuar: al vaciarse la
# mesa, ocupada -> pendiente_limpieza. Ahí, y solo ahí, el silencio implica una falla.
#
# Por qué la cobertura de ROI. Una mesa sin ROI activo en cámara activa no puede
# actualizarse sola por definición, así que marcarla sería reportar un hueco de setup
# —que la pantalla de Configuración ya muestra como "mesas sin ROI"— disfrazado de falla de
# detección. En la base de desarrollo eso es 17 de 20 mesas activas: sin este filtro la
# alerta sería casi todo ruido.
#
# Por qué el horario y no un umbral de horas. Con el local cerrado no hay comensal posible,
# así que una mesa todavía 'ocupada' es inequívocamente un estado que quedó colgado. El
# corte no es una constante elegida a dedo: sale de hora_cierre, que el admin ya configura
# (T26-171). Un "sin actualizar hace N horas" plano, en cambio, mide el ritmo del salón y la
# cobertura de cámaras, no la salud de la detección.
#
# PENDIENTE DE CALIBRACIÓN (deliberado, no un olvido). Falta el caso simétrico: una mesa
# 'ocupada' por más tiempo del razonable DENTRO del horario. Ese umbral necesita saber
# cuánto dura una ocupación real, y hoy no hay con qué calcularlo: el historial de esta
# instalación son 831 filas de las que 724 las escribió la suite e2e y el resto es alguien
# haciendo clic en desarrollo (tramos de 'ocupada' de 0.8 a 2.5 minutos). Cualquier número
# sacado de ahí mediría los tests, no el restaurante. Cuando vision-module haya corrido
# algunos servicios reales, el p90 de duración de 'ocupada' sale de historial_estados y ahí
# el umbral se elige con datos. Hasta entonces esta parte queda apagada, siguiendo el
# criterio de minutos_limpieza_demorada (T26-173) y no el de umbral_ocupacion_alta
# (T26-187): una alerta encendida con un umbral inventado es peor que no tenerla.

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.camara import Camara
from app.models.configuracion import ConfiguracionGeneral
from app.models.mesa import EstadoMesa
from app.models.roi_mesa import RoiMesa
from app.services.horario import en_horario_de_servicio


def es_estado_dudoso(estado, tiene_cobertura: bool, dentro_del_horario: bool) -> bool:
    """Las tres condiciones del criterio, sin tocar la base.

    Separada de las consultas para poder testear la regla sola y para que el orden de los
    cortes quede a la vista. Con el horario sin configurar, en_horario_de_servicio()
    devuelve True siempre (T26-171: sin horario cargado se cuentan las 24 horas), así que
    `dentro_del_horario` es True, nunca se sale del horario y la alerta queda apagada. Ese
    default es intencional y es el mismo que ya tenían las métricas: activar avisos en una
    instalación que todavía no cargó su horario sería inventarle un cierre que no declaró.
    """
    if estado != EstadoMesa.ocupada:
        return False
    if not tiene_cobertura:
        return False
    return not dentro_del_horario


def mesas_con_cobertura_de_deteccion(db: Session, mesa_ids) -> set[int]:
    """Ids, de entre los pedidos, que tienen ROI activo en una cámara activa.

    Una sola consulta agregada en vez de una por mesa: este dato lo necesita GET /mesas/,
    que el dashboard pide cada 3 segundos.
    """
    if not mesa_ids:
        return set()
    filas = (
        db.query(RoiMesa.mesa_id)
        .join(Camara, Camara.id == RoiMesa.camara_id)
        .filter(
            RoiMesa.mesa_id.in_(mesa_ids),
            RoiMesa.activa == True,  # noqa: E712
            Camara.activa == True,  # noqa: E712
        )
        .distinct()
        .all()
    )
    return {fila[0] for fila in filas}


def marcar_estados_dudosos(db: Session, mesas, momento: datetime | None = None) -> None:
    """Deja `estado_dudoso` seteado en cada mesa de la lista, in place.

    Se resuelve para el lote completo y no mesa por mesa: son dos consultas fijas (la fila
    de configuración y la cobertura de ROI) en vez de dos por mesa.

    Si ninguna mesa del lote está 'ocupada' no se consulta nada: la condición 1 ya las
    descarta a todas, y este es el caso común —un salón tranquilo, o la lista filtrada por
    otro estado— así que no tiene sentido pagar las consultas para responder que no.
    """
    ocupadas = [mesa for mesa in mesas if mesa.estado == EstadoMesa.ocupada]
    if not ocupadas:
        for mesa in mesas:
            mesa.estado_dudoso = False
        return

    config = db.query(ConfiguracionGeneral).filter(ConfiguracionGeneral.id == 1).first()
    apertura = config.hora_apertura if config else None
    cierre = config.hora_cierre if config else None
    dentro = en_horario_de_servicio(momento or datetime.now(timezone.utc), apertura, cierre)

    con_cobertura = mesas_con_cobertura_de_deteccion(db, [mesa.id for mesa in ocupadas])

    for mesa in mesas:
        mesa.estado_dudoso = es_estado_dudoso(mesa.estado, mesa.id in con_cobertura, dentro)
