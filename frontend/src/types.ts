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
  // RF-28 (T26-156): dato informativo que carga el admin, sin relación con el COUNT real de
  // mesas activas. null mientras nadie lo haya cargado.
  cantidad_mesas_referencia?: number | null
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

// Conteo de mesas activas por estado. Los cuatro buckets vienen siempre, en 0 si no
// hay mesas en ese estado (el backend los inicializa), así que la UI nunca tiene que
// distinguir "cero mesas" de "campo ausente".
export interface ConteoPorEstado {
  libre: number
  ocupada: number
  pendiente_limpieza: number
  reservada: number
}

// Respuesta de GET /metricas/ocupacion (RF-22).
//
// porcentaje_ocupacion cuenta SOLO las mesas en estado "ocupada" (decisión de T26-154,
// ver backend/app/routers/metricas.py): una mesa reservada todavía está físicamente
// libre, así que sumarla sobreestimaría cuánto salón está realmente en uso. Sigue
// viniendo en conteo_por_estado como bucket aparte, y el panel la muestra ahí sin
// mezclarla con el %.
//
// Con total_mesas == 0 el backend devuelve 0.0, que no significa "salón desocupado"
// sino "no hay nada que medir": OcupacionPage lo trata como empty state, no como 0%.
export interface OcupacionResponse {
  total_mesas: number
  porcentaje_ocupacion: number
  conteo_por_estado: ConteoPorEstado
}

// Una fila de GET /metricas/rotacion (RF-23): cuántas veces rotó cada mesa activa en el
// rango pedido.
//
// "Rotación" es una TRANSICIÓN hacia ocupada desde un estado distinto, no una fila cruda de
// historial con estado='ocupada' (decisión de T26-155, ver backend/app/routers/metricas.py).
// Dos correcciones manuales seguidas a 'ocupada' cuentan como una sola rotación, y una mesa
// que ya venía ocupada de antes del rango no suma por entrar al rango.
//
// Trae sector_id, no el nombre del sector: para mostrarlo hay que cruzarlo con
// sectoresApi.listar(). Las mesas sin rotaciones vienen igual, con rotaciones: 0.
export interface RotacionMesa {
  mesa_id: number
  numero: number
  sector_id: number
  rotaciones: number
}
