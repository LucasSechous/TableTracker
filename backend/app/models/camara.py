# Modelo SQLAlchemy para la tabla camaras.
# Representa una cámara IP del local.
#
# El esquema original lo definió T26-125 (aplicado directo en Supabase, no en el
# repo) con una sola columna `rtsp_url` que guardaba la conexión entera,
# credenciales incluidas, en claro. T26-136 la reemplaza por una columna por
# parte, con la contraseña —lo único que es secreto— cifrada en
# `password_cifrada`. La migración está en database/, versionada.
#
# Separar en columnas en vez de cifrar la URL entera tiene dos motivos:
#
#   - El GET nunca descifra. Para enmascarar alcanza con esquema/host/puerto/ruta
#     y usuario, que están en claro; la contraseña solo se descifra en
#     test-conexion y snapshot, que son de a una cámara. Listar 20 cámaras no
#     pasa 20 contraseñas por memoria.
#   - Perder la clave cuesta recargar contraseñas, no perder las cámaras. Con la
#     URL entera cifrada, quedarse sin clave se lleva puesta también la
#     configuración de red de cada cámara.

from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
from app.services import cifrado, rtsp


class Camara(Base):
    __tablename__ = "camaras"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    # Partes de rtsp://usuario:password@host:puerto/ruta, separadas (T26-136).
    # `esquema` distingue rtsp de rtsps: RTSP sobre TLS no se puede reconstruir
    # como rtsp:// sin degradar en silencio un stream cifrado.
    esquema = Column(String, nullable=False, default="rtsp", server_default="rtsp")
    host = Column(String, nullable=False)
    puerto = Column(Integer, nullable=False, default=rtsp.PUERTO_RTSP_DEFECTO, server_default="554")
    # Incluye la query cuando la hay (?channel=1&subtype=0): en varias marcas es
    # parte de la identificación del stream, no un parámetro opcional.
    ruta = Column(String, nullable=False, default="/", server_default="/")
    usuario = Column(String, nullable=True)
    # Token Fernet, nunca la contraseña en claro. NULL = la cámara no tiene
    # contraseña, que no es lo mismo que tener una vacía.
    password_cifrada = Column(Text, nullable=True)
    sector_id = Column(Integer, ForeignKey("sectores.id"), nullable=False)
    activa = Column(Boolean, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sector = relationship("Sector")
    rois = relationship("RoiMesa", back_populates="camara")

    @staticmethod
    def partes_desde_url(rtsp_url: str) -> dict:
        """Descompone una URL completa en los valores de columna, cifrando la contraseña.

        Es el único punto por el que una contraseña entra a la base. Lanza
        ValueError si la URL no sirve; los schemas ya la validaron antes, así que
        llegar acá con una URL rota sería un error de programación, no de entrada.
        """
        datos = rtsp.parsear_url(rtsp_url)
        return {
            "esquema": datos.esquema,
            "host": datos.host,
            "puerto": datos.puerto,
            "ruta": datos.ruta,
            "usuario": datos.usuario,
            "password_cifrada": cifrado.cifrar(datos.password),
        }

    @property
    def rtsp_url_enmascarada(self) -> str:
        # Lo único que sale por la API. No descifra nada: la contraseña se
        # reemplaza por el centinela sin llegar a leerla.
        return rtsp.enmascarar_partes(
            self.host,
            self.puerto,
            self.ruta,
            self.usuario,
            tiene_password=bool(self.password_cifrada),
            esquema=self.esquema,
        )

    @property
    def tiene_credenciales(self) -> bool:
        return bool(self.usuario)

    @property
    def password(self) -> str | None:
        """La contraseña en claro. Solo para hablar con la cámara — nunca a una respuesta."""
        return cifrado.descifrar(self.password_cifrada)

    @property
    def rtsp_url_completa(self) -> str:
        """URL con la contraseña real, para pasarle a OpenCV en el snapshot.

        `test-conexion` no la usa: le pasa las partes sueltas a rtsp.probar_conexion,
        que manda las credenciales en la cabecera Authorization y no en la URL.
        """
        return rtsp.construir_url(
            self.host, self.puerto, self.ruta, self.usuario, self.password, esquema=self.esquema
        )
