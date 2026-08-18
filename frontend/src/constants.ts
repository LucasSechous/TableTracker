// Constantes compartidas del canvas del salón, usadas tanto por el render (MesaVisual)
// como por los cálculos de posición (alta de mesa, clamp de drag). El tamaño del salón
// (ancho/alto) ya no es una constante: se lee de GET /configuracion.

export const DIAMETRO_MESA = 60

// Color por estado de mesa, compartido entre MesaVisual (relleno del círculo) y la
// leyenda del canvas (SalonCanvas).
export const COLOR_POR_ESTADO: Record<string, string> = {
  libre: "#4caf50",
  ocupada: "#f44336",
  pendiente_limpieza: "#ff9800",
  reservada: "#2196f3",
}
