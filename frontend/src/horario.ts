// Presentación del horario de servicio del lado del cliente (T26-171).
//
// Este archivo tenía además una reimplementación de `en_horario_de_servicio()` del backend,
// incluido el cruce de medianoche. Se dio de baja en T26-200 (hallazgo F-2): la respuesta a
// "¿el local está abierto ahora?" ahora la da el backend y viaja dentro de GET
// /metricas/ocupacion, que es el endpoint que el único consumidor —el panel de ocupación— ya
// pedía. Ver el comentario de `local_abierto` en schemas/metricas.py.
//
// Los dos motivos por los que la copia no se sostenía:
//
// 1. La regla dejó de tener dos lados y pasó a tener tres. Además de la rotación (T26-171),
//    RF-27 (T26-188) la usa en services/estado_dudoso.py para decidir si una mesa es dudosa.
// 2. Los husos no coincidían. El backend evalúa contra TZ_LOCAL (America/Montevideo); esta
//    copia usaba `momento.getHours()`, o sea el reloj del navegador. Con RF-27 la
//    consecuencia se volvió visible: el dashboard podía marcar una mesa como dudosa —por
//    tener el local cerrado— mientras el panel de ocupación decía que estaba abierto.
//
// Queda solo el formateo, que sí es responsabilidad de la vista.

/** "20:00:00" -> "20:00", para mostrar sin los segundos que devuelve el backend. */
export function sinSegundos(hora: string): string {
  return hora.slice(0, 5)
}
