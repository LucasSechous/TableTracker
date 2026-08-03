# Contrato de salida del módulo de detección (vision-module), Sprint 5.
# Define la forma exacta del resultado por frame que el backend consumirá en el Sprint 6 (RF-10/RF-11).

from datetime import datetime, timedelta

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DetectionBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x1: int = Field(..., ge=0, description="Coordenada X de la esquina superior izquierda, en píxeles")
    y1: int = Field(..., ge=0, description="Coordenada Y de la esquina superior izquierda, en píxeles")
    x2: int = Field(..., ge=0, description="Coordenada X de la esquina inferior derecha, en píxeles")
    y2: int = Field(..., ge=0, description="Coordenada Y de la esquina inferior derecha, en píxeles")

    @field_validator("x2")
    @classmethod
    def _x2_mayor_que_x1(cls, v, info):
        x1 = info.data.get("x1")
        if x1 is not None and v <= x1:
            raise ValueError("x2 debe ser mayor que x1")
        return v

    @field_validator("y2")
    @classmethod
    def _y2_mayor_que_y1(cls, v, info):
        y1 = info.data.get("y1")
        if y1 is not None and v <= y1:
            raise ValueError("y2 debe ser mayor que y1")
        return v


class Detection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class_id: int = Field(..., ge=0, description="ID de clase del modelo, ej. índice COCO")
    class_name: str = Field(..., min_length=1, description="Nombre legible de la clase, ej. 'dining table'")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confianza de la detección, entre 0 y 1")
    bbox: DetectionBox


class DetectionFrameResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="1.0", description="Versión del contrato de salida")
    frame_timestamp: datetime = Field(..., description="Instante de captura del frame, en UTC")
    source_id: str = Field(..., min_length=1, description="Identificador de la cámara o fuente de video")
    frame_width: int = Field(..., gt=0, description="Ancho del frame de referencia, en píxeles")
    frame_height: int = Field(..., gt=0, description="Alto del frame de referencia, en píxeles")
    model_name: str = Field(..., min_length=1, description="Nombre del modelo usado, ej. 'yolov8n'")
    detections: list[Detection] = Field(default_factory=list, description="Detecciones encontradas en el frame")

    @field_validator("frame_timestamp")
    @classmethod
    def _timestamp_en_utc(cls, v):
        if v.tzinfo is None or v.utcoffset() != timedelta(0):
            raise ValueError("frame_timestamp debe estar en UTC (datetime con tzinfo UTC)")
        return v
