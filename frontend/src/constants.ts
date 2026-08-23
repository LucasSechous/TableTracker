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

// Borde de la mesa: mismo tono que COLOR_POR_ESTADO pero un escalón más oscuro
// (Material 700 en vez de 500), para que el borde refuerce el estado en vez de
// ser un gris genérico.
export const BORDE_POR_ESTADO: Record<string, string> = {
  libre: "#388e3c",
  ocupada: "#d32f2f",
  pendiente_limpieza: "#f57c00",
  reservada: "#1976d2",
}
