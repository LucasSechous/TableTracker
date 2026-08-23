// Tipos de dominio compartidos por todos los componentes de TableTracker.
// Corresponden a los schemas del backend con campos de posición para el canvas 2D.

export interface Mesa {
  id: number
  numero: number
  estado: string
  activa: boolean
  pos_x: number
  pos_y: number
  created_at: string
  sector: { id: number; nombre: string }
}

export interface Sector {
  id: number
  nombre: string
  descripcion?: string
  activo: boolean
  pos_x: number
  pos_y: number
  ancho: number
  alto: number
  mesas?: Mesa[]
}

export type Modo = "monitoreo" | "edicion"

export interface Configuracion {
  ancho_salon: number
  alto_salon: number
  nombre_establecimiento?: string | null
}

export interface HistorialEstado {
  id: number
  mesa_id: number
  estado: string
  created_at: string
}

export interface Camara {
  id: number
  nombre: string
  sector_id: number
  sector: { id: number; nombre: string }
  // Enmascarada por la API (rtsp://usuario:***@host:puerto/ruta): nunca trae la contraseña.
  rtsp_url: string
  tiene_credenciales: boolean
  activa: boolean
  created_at: string
}

// Respuesta de POST /camaras/{id}/test-conexion. Siempre HTTP 200 (que la cámara no
// responda no es un error de la API): el resultado real viaja en ok/mensaje.
export interface CamaraTestResponse {
  ok: boolean
  mensaje: string
  codigo_rtsp: number | null
  latencia_ms: number | null
  rtsp_url: string
}

// [x, y] en píxeles reales del frame devuelto por GET /camaras/{id}/snapshot.
export type PuntoRoi = [number, number]

export interface RoiMesa {
  id: number
  mesa_id: number
  mesa_numero: number | null
  camara_id: number
  camara_nombre: string | null
  coordenadas: PuntoRoi[]
  activa: boolean
  created_at: string
}

// Bounding box de una detección, en píxeles reales del frame que la generó
// (frame_width/frame_height de DetectionFrameResult) — no necesariamente el mismo
// frame que el snapshot mostrado en pantalla, ver DetectionFrameResult.
export interface DetectionBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Detection {
  class_id: number
  class_name: string
  confidence: number
  bbox: DetectionBox
}

// Respuesta de GET /camaras/{id}/deteccion-actual (T26-150): último resultado de
// detección que publicó vision-module para esa cámara. 404 (no un cuerpo con
// detections: []) si todavía no llegó ninguno — ver useDeteccionActual.
export interface DetectionFrameResult {
  schema_version: string
  frame_timestamp: string
  source_id: string
  frame_width: number
  frame_height: number
  model_name: string
  detections: Detection[]
}
