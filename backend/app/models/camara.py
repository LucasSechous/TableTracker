# Modelo SQLAlchemy para la tabla camaras.
# Representa una cámara IP del local.
#
# El esquema lo define T26-125, que se aplicó directo en Supabase y no está en el
# repo: este modelo lo refleja, no lo decide. En particular la conexión va entera
# en `rtsp_url` (credenciales incluidas), así que la contraseña queda en claro en
# la base — ver docs/camaras-roi.md.

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
from app.services import rtsp


class Camara(Base):
    __tablename__ = "camaras"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    # rtsp://usuario:password@host:puerto/ruta
    rtsp_url = Column(String, nullable=False)
    sector_id = Column(Integer, ForeignKey("sectores.id"), nullable=False)
    activa = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sector = relationship("Sector")
    rois = relationship("RoiMesa", back_populates="camara")

    @property
    def rtsp_url_enmascarada(self) -> str:
        # Lo único que sale por la API: la misma URL con la contraseña tapada.
        return rtsp.enmascarar_url(self.rtsp_url)

    @property
    def tiene_credenciales(self) -> bool:
        try:
            return bool(rtsp.parsear_url(self.rtsp_url).usuario)
        except ValueError:
            return False
