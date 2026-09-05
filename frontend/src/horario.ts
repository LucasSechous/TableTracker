// Franja horaria de servicio del lado del cliente (T26-171).
//
// Espeja app/services/horario.py del backend, pero para una pregunta distinta: el
// backend decide qué transiciones históricas CUENTAN para la rotación; acá solo se
// responde "¿el local está abierto ahora?", que es lo que necesita el panel de
// ocupación para avisar que su número corresponde a un momento con el local cerrado.
//
// El cálculo NO se replica en el sentido de duplicar reglas de negocio: la rotación
// sigue acotándose enteramente en el servidor. Lo único que se comparte es la forma de
// la franja, y por eso el caso de medianoche está resuelto igual en los dos lados.

/** Horas en "HH:MM" o "HH:MM:SS"; se comparan como texto, que para ese formato ordena igual que el reloj. */
function aMinutos(hora: string): number {
  const [h, m] = hora.split(":")
  return Number(h) * 60 + Number(m)
}

/**
 * Si un momento cae dentro de la franja de servicio.
 *
 * Sin horario cargado devuelve true: el comportamiento por defecto es "siempre en
 * horario", igual que en el backend, para no avisar de nada a quien no configuró nada.
 *
 * La hora se toma del reloj del navegador. Para el caso real —alguien mirando el panel
 * en el propio local— es la hora correcta. Un navegador en otro huso vería el aviso
 * corrido, pero es un aviso informativo, no un cálculo.
 */
export function enHorarioDeServicio(
  momento: Date,
  apertura: string | null | undefined,
  cierre: string | null | undefined
): boolean {
  if (!apertura || !cierre) return true

  const inicio = aMinutos(apertura)
  const fin = aMinutos(cierre)
  // Apertura igual a cierre se lee como "abierto todo el día", no como un instante.
  if (inicio === fin) return true

  const ahora = momento.getHours() * 60 + momento.getMinutes()

  if (inicio < fin) return ahora >= inicio && ahora <= fin

  // Cruza medianoche (20:00 -> 02:00): la franja es el complemento del rango, no el rango.
  return ahora >= inicio || ahora <= fin
}

/** "20:00:00" -> "20:00", para mostrar sin los segundos que devuelve el backend. */
export function sinSegundos(hora: string): string {
  return hora.slice(0, 5)
}
