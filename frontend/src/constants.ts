// Constantes compartidas del canvas del salón, usadas tanto por el render (MesaVisual)
// como por los cálculos de posición (alta de mesa, clamp de drag). El tamaño del salón
// (ancho/alto) ya no es una constante: se lee de GET /configuracion.

export const DIAMETRO_MESA = 60

// Color por estado de mesa, compartido entre MesaVisual (relleno del cuadrado) y la
// leyenda del canvas (SalonCanvas).
export const COLOR_POR_ESTADO: Record<string, string> = {
  libre: "#4caf50",
  ocupada: "#f44336",
  pendiente_limpieza: "#ff9800",
  reservada: "#2196f3",
}

// Piso del tamaño del salón cuando todavía no hay ningún sector que lo condicione.
export const TAMANO_MINIMO_SALON = 200

// El salón no puede achicarse más allá de lo que ocupan sus sectores activos: hacerlo los
// dejaría dibujados fuera del canvas. Lo usan las dos formas de cambiar el tamaño —el drag
// del handle en SalonCanvas y los inputs de la pantalla de configuración— para que las dos
// respeten el mismo piso. El backend solo valida gt=0, así que este límite vive acá.
export function calcularMinimoSalon(
  sectores: { activo: boolean; pos_x: number; pos_y: number; ancho: number; alto: number }[]
): { ancho: number; alto: number } {
  const activos = sectores.filter((s) => s.activo)
  if (activos.length === 0) {
    return { ancho: TAMANO_MINIMO_SALON, alto: TAMANO_MINIMO_SALON }
  }
  return {
    ancho: Math.max(...activos.map((s) => s.pos_x + s.ancho)),
    alto: Math.max(...activos.map((s) => s.pos_y + s.alto)),
  }
}

// Borde de la mesa: mismo tono que COLOR_POR_ESTADO pero un escalón más oscuro
// (Material 700 en vez de 500), para que el borde refuerce el estado en vez de
// ser un gris genérico.
export const BORDE_POR_ESTADO: Record<string, string> = {
  libre: "#388e3c",
  ocupada: "#d32f2f",
  pendiente_limpieza: "#f57c00",
  reservada: "#1976d2",
}

// Texto legible de cada estado, en singular: describe UNA mesa ("Ocupada").
// Vivía duplicado en PanelMesa, SalonCanvas e HistorialPage con exactamente los
// mismos valores; se unifica acá junto al resto de la paleta por estado.
//
// OcupacionPage NO usa este mapa a propósito: ahí las etiquetas rotulan conteos y
// van en plural ("Ocupadas"), así que compartirlo cambiaría el texto que ve el
// usuario. Son dos vocabularios distintos, no una cuarta copia por descuido.
//
// El backend expone las mismas etiquetas en GET /estados/ (routers/estados.py).
// Este mapa es el de render inmediato, sin esperar una request; el endpoint es la
// fuente para pantallas que listan los estados como dato.
// Color del aviso de limpieza demorada (T26-173).
//
// Deliberadamente NO se suma a COLOR_POR_ESTADO: esa paleta representa ESTADOS de mesa, y
// "atrasada" no es un estado sino una condición sobre uno (pendiente_limpieza que se
// estiró). Meterlo ahí obligaría a inventar un quinto estado que el backend no tiene y
// rompería la correspondencia uno a uno entre la leyenda y el enum EstadoMesa.
export const COLOR_LIMPIEZA_DEMORADA = "#b71c1c"

// Color del aviso de alta ocupación del salón (T26-187, RF-26).
//
// Por el mismo motivo que COLOR_LIMPIEZA_DEMORADA no entra en COLOR_POR_ESTADO: "el salón
// está al límite" no es un estado de mesa sino una condición del conjunto.
//
// Ámbar y no el rojo de la limpieza demorada, a propósito: las dos alertas pueden estar
// encendidas al mismo tiempo y con el mismo color el usuario no sabría cuál está mirando.
// Además difieren en urgencia — una limpieza atrasada es algo que alguien tiene que ir a
// resolver ahora, mientras que un salón lleno es una situación a la que hay que estar
// atento, no un error que corregir.
export const COLOR_OCUPACION_ALTA = "#b45309"

// Color del aviso de estado dudoso (T26-188, RF-27).
//
// Tercer color de condición, por el mismo motivo que los dos de arriba no entran en
// COLOR_POR_ESTADO: "puede estar mal detectada" no es un estado de mesa.
//
// Violeta y no rojo ni ámbar: los tres avisos del producto tienen que distinguirse de un
// vistazo, y este además dice algo distinto. El de limpieza demorada y el de salón lleno
// afirman un hecho ("hace 40 minutos que está así"); este afirma una DUDA sobre el dato
// —la mesa figura ocupada pero el local está cerrado, así que probablemente el estado esté
// mal—. Un rojo lo leería como una urgencia operativa que no es: nadie tiene que correr a
// la mesa, hay que revisar por qué la detección la dejó colgada.
export const COLOR_ESTADO_DUDOSO = "#6d28d9"

/**
 * Minutos que una mesa lleva en su estado actual, o null si no se sabe.
 *
 * Devuelve null —y no 0— cuando falta `estado_desde`: una mesa de la que no se conoce el
 * reloj no es una mesa que acaba de cambiar, y tratarla como 0 la haría pasar por recién
 * liberada para siempre.
 */
export function minutosEnEstado(estadoDesde: string | null | undefined): number | null {
  if (!estadoDesde) return null
  const desde = new Date(estadoDesde)
  if (Number.isNaN(desde.getTime())) return null
  return Math.floor((Date.now() - desde.getTime()) / 60000)
}

/**
 * Si una mesa está atrasada en su limpieza.
 *
 * Solo aplica a pendiente_limpieza: una mesa ocupada hace tres horas es una sobremesa
 * larga, no un problema operativo, y marcarla en rojo sería ruido.
 */
export function limpiezaDemorada(
  estado: string,
  estadoDesde: string | null | undefined,
  umbralMinutos: number | null | undefined
): boolean {
  if (estado !== "pendiente_limpieza" || !umbralMinutos) return false
  const minutos = minutosEnEstado(estadoDesde)
  return minutos !== null && minutos >= umbralMinutos
}

export const ETIQUETA_POR_ESTADO: Record<string, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pendiente_limpieza: "Pendiente de limpieza",
  reservada: "Reservada",
}
