# Modelo SQLAlchemy para la tabla configuracion_general.
# Fila única (id=1, forzado por CHECK en la base) con los parámetros globales del salón.

from sqlalchemy import Column, Integer, String, DateTime, Time, CheckConstraint, text
from sqlalchemy.sql import func
from app.database import Base


class ConfiguracionGeneral(Base):
    __tablename__ = "configuracion_general"
    __table_args__ = (CheckConstraint("id = 1", name="configuracion_general_singleton"),)

    # autoincrement=False: es una fila única, no una secuencia. Sin esto
    # SQLAlchemy trataría el PK entero como SERIAL, que no es lo que hay en la base.
    id = Column(Integer, primary_key=True, autoincrement=False, default=1, server_default=text("1"))
    nombre_establecimiento = Column(String, nullable=True)
    # server_default: la base ya los tenía y el modelo no los declaraba (T26-137).
    ancho_salon = Column(Integer, nullable=False, default=1200, server_default=text("1200"))
    alto_salon = Column(Integer, nullable=False, default=700, server_default=text("700"))
    # RF-28 (T26-156): dato de referencia informativo, no una constraint sobre la
    # cantidad real de mesas activas — por eso nullable, sin default ni relación
    # con COUNT(mesas).
    cantidad_mesas_referencia = Column(Integer, nullable=True)
    # Horario de servicio (T26-171). Nullable y sin default a propósito: mientras no
    # estén cargadas, las métricas cuentan las 24 horas, que es exactamente el
    # comportamiento que ya tenían. Activar el recorte sin que nadie lo pida cambiaría
    # los números de una instalación existente de un día para el otro.
    #
    # Son horas sin fecha ni huso (Time, no DateTime): describen "a qué hora abre el
    # local", no un instante. El huso contra el que se comparan es TZ_LOCAL en
    # app/services/horario.py, no un dato de esta fila.
    #
    # hora_cierre PUEDE ser menor que hora_apertura: 20:00 -> 02:00 es el caso normal de
    # un restaurante, no un borde raro. Ver en_horario_de_servicio().
    hora_apertura = Column(Time, nullable=True)
    hora_cierre = Column(Time, nullable=True)
    # Minutos que una mesa puede estar en pendiente_limpieza antes de considerarse
    # atrasada (T26-173). Nullable y sin default a propósito: mientras no se cargue, la
    # función queda apagada y el canvas se ve exactamente como antes. Poner un valor por
    # defecto llenaría el salón de avisos que nadie pidió.
    minutos_limpieza_demorada = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
