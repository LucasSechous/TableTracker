from sqlalchemy import Column, Integer, String, Boolean, text
from sqlalchemy.orm import relationship
from app.database import Base


class Sector(Base):
    __tablename__ = "sectores"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, unique=True, nullable=False)
    descripcion = Column(String, nullable=True)
    activo = Column(Boolean, default=True)
    # server_default además de default: el de Python sólo corre en un INSERT del
    # ORM, así que sin esto un INSERT en SQL crudo (una migración, el panel de
    # Supabase) dejaría NULL en una columna NOT NULL. La base ya los tenía; los
    # modelos no los declaraban (T26-137).
    pos_x = Column(Integer, nullable=False, default=0, server_default=text("0"))
    pos_y = Column(Integer, nullable=False, default=0, server_default=text("0"))
    ancho = Column(Integer, nullable=False, default=400, server_default=text("400"))
    alto = Column(Integer, nullable=False, default=300, server_default=text("300"))

    mesas = relationship("Mesa", back_populates="sector")
