# Modelo SQLAlchemy para la tabla roi_mesa.
# Asocia una mesa con la región de interés (ROI) que ocupa dentro del frame de
# una cámara concreta.
#
# El esquema lo define T26-125, que se aplicó directo en Supabase y no está en el
# repo: este modelo lo refleja, no lo decide. Notar que la base NO tiene un UNIQUE
# sobre (mesa_id, camara_id) — esa regla se aplica solo en el router.

from sqlalchemy import Column, Integer, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class RoiMesa(Base):
    __tablename__ = "roi_mesa"

    id = Column(Integer, primary_key=True, index=True)
    mesa_id = Column(Integer, ForeignKey("mesas.id"), nullable=False)
    camara_id = Column(Integer, ForeignKey("camaras.id"), nullable=False)
    # Polígono [[x, y], ...] en píxeles del frame: mismo formato que consume el
    # módulo de visión (ver vision-module/config/zonas.example.json), para no
    # tener que traducir nada entre el backend y el pipeline de detección.
    # Se reasigna entero en cada edición, nunca se muta in place (SQLAlchemy no
    # detecta cambios dentro de una columna JSON).
    coordenadas = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    activa = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    mesa = relationship("Mesa")
    camara = relationship("Camara", back_populates="rois")

    @property
    def mesa_numero(self):
        # Datos de contexto para la UI, que lista ROIs sin tener las mesas cargadas.
        return self.mesa.numero if self.mesa else None

    @property
    def camara_nombre(self):
        return self.camara.nombre if self.camara else None
