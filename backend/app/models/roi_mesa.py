# Modelo SQLAlchemy para la tabla roi_mesa.
# Asocia una mesa con la región de interés (ROI) que ocupa dentro del frame de
# una cámara concreta.
#
# El esquema lo definió T26-125, que se aplicó directo en Supabase y no llegó al
# repo; desde T26-137 lo gobiernan las revisiones de database/versions/.

from sqlalchemy import Column, Integer, Boolean, DateTime, ForeignKey, JSON, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class RoiMesa(Base):
    __tablename__ = "roi_mesa"

    # "Una mesa tiene un solo ROI por cámara", ahora también en el motor (T26-141).
    # Aplica a la fila exista o no la baja lógica: un ROI inactivo sigue ocupando
    # el par, que es justo lo que hace que volver a darlo de alta lo reutilice en
    # vez de duplicarlo (ver routers/roi.py). Una misma mesa sí puede tener ROI en
    # varias cámaras distintas — eso es intencional y el UNIQUE no lo impide.
    __table_args__ = (
        UniqueConstraint("mesa_id", "camara_id", name="roi_mesa_mesa_camara_unique"),
    )

    id = Column(Integer, primary_key=True, index=True)
    mesa_id = Column(Integer, ForeignKey("mesas.id"), nullable=False)
    camara_id = Column(Integer, ForeignKey("camaras.id"), nullable=False)
    # Polígono [[x, y], ...] en píxeles del frame: mismo formato que consume el
    # módulo de visión (ver vision-module/config/zonas.example.json), para no
    # tener que traducir nada entre el backend y el pipeline de detección.
    # Se reasigna entero en cada edición, nunca se muta in place (SQLAlchemy no
    # detecta cambios dentro de una columna JSON).
    coordenadas = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    activa = Column(Boolean, default=True, server_default=text("true"))
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
