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
  // Desde cuándo está en este estado, ISO (T26-173). Lo manda el backend denormalizado
  // en la fila: el dashboard pide /mesas cada 3s y no puede pagar un cruce por ciclo.
  estado_desde?: string | null
  // Posible error de detección (T26-188, RF-27): sigue 'ocupada' con el local cerrado y
  // teniendo cobertura de cámara. Lo resuelve el backend, que es el único que sabe la hora
  // de cierre y qué mesas tienen ROI activo; acá NO se recalcula nada.
  //
  // Opcional porque las respuestas anteriores al ticket no lo traen y porque el POST de
  // alta y el PATCH de estado lo devuelven en su default; ausente se trata como false.
  estado_dudoso?: boolean
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
  // Horario de servicio (T26-171), en formato HH:MM:SS. null mientras no se cargue, y en
  // ese caso las metricas cuentan las 24 horas igual que antes del ticket.
  //
  // hora_cierre PUEDE ser menor que hora_apertura: 20:00 -> 02:00 es un local que cierra
  // despues de medianoche, no un dato invertido por error.
  hora_apertura?: string | null
  hora_cierre?: string | null
  // Minutos en pendiente_limpieza antes de marcar la mesa como atrasada (T26-173).
  // null = alerta apagada.
  minutos_limpieza_demorada?: number | null
  // Umbrales de detección de vision-module (T26-183, RF-28). Nunca null: son NOT NULL
  // con default en el backend desde que se creó la columna.
  //
  // confirmacion_segundos: cuánto tiene que sostenerse una observación antes de que se
  // confirme el cambio de estado de una mesa. overlap_minimo: qué fracción de la persona
  // detectada tiene que superponerse con la mesa para contarla como ocupada.
  confirmacion_segundos: number
  overlap_minimo: number
  // Porcentaje de mesas ocupadas a partir del cual el salón se considera al límite
  // (T26-187, RF-26). Nunca null: NOT NULL con default 85 en el backend.
  //
  // A diferencia de minutos_limpieza_demorada, esta alerta no se puede apagar dejando el
  // campo vacío. Si hiciera falta apagarla, el equivalente es ponerla en 100: solo alerta
  // con el salón completo.
  umbral_ocupacion_alta: number
}

// Respuesta del PATCH cuando cambia alguno de los umbrales de detección: el backend
// informa el valor anterior porque cambiarlos en caliente afecta a la detección en curso
// sin que nadie lo vea venir, y no queda ningún otro registro de qué valía antes.
export interface ConfiguracionActualizada extends Configuracion {
  confirmacion_segundos_anterior?: number | null
  overlap_minimo_anterior?: number | null
}

// Origen de un cambio de estado (T26-163). null en las filas anteriores al ticket: el dato
// no se registraba, y eso NO es lo mismo que "fue manual".
export type OrigenCambio = "automatico" | "manual"

export interface HistorialEstado {
  id: number
  mesa_id: number
  estado: string
  created_at: string
  origen_cambio: OrigenCambio | null
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
  // Alerta de alta ocupación (T26-187, RF-26). La comparación la resuelve el backend y acá
  // llega hecha: el cliente NO reimplementa el >= contra el umbral. El umbral viene igual
  // para poder rotular el aviso ("92% del salón ocupado, umbral 85%") sin pedir
  // /configuracion por separado.
  umbral_ocupacion_alta: number
  ocupacion_alta: boolean
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

// Respuesta de GET /metricas/ocupacion-diaria (T26-185, RF-32).
//
// A diferencia de OcupacionResponse (foto del instante) acá los números son minutos,
// reconstruidos desde historial_estados para el "día operativo" de `fecha` — que no es
// medianoche a medianoche sino el horario real del local (`inicio`/`fin`, tal como los
// devuelve el backend), para no partir en dos un turno que cruza la medianoche.
export interface TiempoPorEstado {
  libre: number
  ocupada: number
  pendiente_limpieza: number
  reservada: number
}

export interface OcupacionDiariaMesa {
  mesa_id: number
  numero: number
  sector_id: number
  minutos_por_estado: TiempoPorEstado
  porcentaje_ocupacion: number
}

export interface OcupacionDiariaResponse {
  fecha: string
  inicio: string
  fin: string
  total_mesas: number
  porcentaje_ocupacion: number
  minutos_por_estado: TiempoPorEstado
  mesas: OcupacionDiariaMesa[]
}

// Fila de GET/PATCH /usuarios/{id} (T26-175): gestión de usuarios desde la app.
//
// es_cuenta_servicio marca la cuenta de vision-module (por email, no por rol: hoy esa
// cuenta puede tener rol "mozo" — ver docs/vision-loop.md) para que la pantalla avise
// antes de desactivarla; el backend igual la protege aunque la UI no mostrara el aviso.
export interface UsuarioAdmin {
  id: number
  nombre: string
  email: string
  rol: string
  activo: boolean
  es_cuenta_servicio: boolean
}

// Un estado posible de mesa, tal como lo lista GET /estados/ (T26-157, RF-29).
//
// `valor` es la clave del enum EstadoMesa del backend (libre, ocupada,
// pendiente_limpieza, reservada) y es la que cruza contra COLOR_POR_ESTADO;
// `etiqueta` es el texto legible que decide el backend. El endpoint es de solo
// lectura: RF-29 pedía administrar los estados, pero el enum está hardcodeado en
// varios puntos del sistema y el CRUD quedó fuera de alcance (ver estados.py).
export interface EstadoOpcion {
  valor: string
  etiqueta: string
}

// Una franja del reporte de horarios de mayor demanda (T26-186, RF-24).
//
// `hora` es la hora del reloj LOCAL (0-23). Solo vienen las franjas DENTRO del horario de
// servicio y con datos medidos: la lista no tiene 24 elementos, y una hora ausente significa
// "el reporte no dice nada de esa hora", no "0% de ocupación".
export interface DemandaFranja {
  hora: number
  porcentaje_ocupacion: number
  // Crudos además del porcentaje: 100% sobre 20 minutos medidos no es lo mismo que 100%
  // sobre 18 horas, y sin esto el gráfico invita a leer una tendencia donde hay una muestra
  // chica. La UI los usa para rotular el tamaño de muestra.
  minutos_ocupada: number
  minutos_medidos: number
}

export interface DemandaResponse {
  fecha_inicio: string
  fecha_fin: string
  // Días operativos incluidos: con 1 el resultado es una anécdota, no un patrón.
  dias: number
  franjas: DemandaFranja[]
}
