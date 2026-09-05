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
