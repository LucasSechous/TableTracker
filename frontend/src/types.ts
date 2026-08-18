// Tipos de dominio compartidos por todos los componentes de TableTracker.
// Corresponden a los schemas del backend con campos de posición para el canvas 2D.

export interface Mesa {
  id: number
  numero: number
  estado: string
  activa: boolean
  pos_x: number
  pos_y: number
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
