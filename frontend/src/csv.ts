// Generación y descarga de CSV en el cliente (T26-174).
//
// No hay endpoint de exportación en el backend y no se agrega uno: lo que se baja es
// exactamente lo que la pantalla está mostrando —mismos filtros, mismo orden—, así que
// armarlo en el cliente evita duplicar la lógica de filtrado del lado del servidor y que
// las dos versiones se desincronicen.
//
// Todo el archivo está calibrado para que Excel en español lo abra bien de un doble click,
// que es el caso real de uso. Cada decisión de formato está comentada donde se toma.

// Excel NO usa la coma como separador de columnas: usa el "separador de listas" de la
// configuración regional, que en es-AR/es-UY/es-ES es el punto y coma. Con coma, Excel mete
// la fila entera en una sola celda y hay que ir a "Texto en columnas" a mano.
const SEPARADOR = ";"

// Sin BOM, Excel asume la codificación ANSI del sistema (Windows-1252) y los acentos y la ñ
// salen como "Ã±". El BOM es la única forma confiable de que tome UTF-8 al abrir por doble
// click; la extensión .csv no alcanza.
const BOM = "\uFEFF"

// CRLF es lo que especifica el RFC 4180 y lo que Excel espera en Windows.
const FIN_DE_LINEA = "\r\n"

export type CeldaCsv = string | number | null | undefined

/**
 * Coma decimal, en coherencia con el punto y coma como separador de columnas: en una
 * configuración regional española, un "1.5" se lee como texto o como 15, no como 1,5.
 *
 * Los enteros se dejan tal cual: no llevan separador de miles a propósito, porque el punto
 * de miles convertiría el número en texto para Excel.
 */
export function formatearNumeroCsv(valor: number): string {
  if (!Number.isFinite(valor)) return ""
  return Number.isInteger(valor) ? String(valor) : String(valor).replace(".", ",")
}

/**
 * dd/mm/aaaa hh:mm:ss — el formato que un Excel en español reconoce como fecha-hora real
 * (se puede ordenar y filtrar por rango), en vez de importarlo como texto.
 *
 * Se usa la hora local del navegador, igual que el resto de las pantallas, que muestran
 * las fechas con toLocaleString(). Exportar en UTC daría un CSV que no coincide con lo que
 * el usuario tiene delante.
 */
export function formatearFechaCsv(iso: string): string {
  const fecha = new Date(iso)
  // Ante una fecha que no parsea se devuelve el original: un "Invalid Date" en la celda
  // esconde el dato, el crudo al menos deja rastrear qué llegó.
  if (Number.isNaN(fecha.getTime())) return iso
  const dosDigitos = (n: number) => String(n).padStart(2, "0")
  const dia = dosDigitos(fecha.getDate())
  const mes = dosDigitos(fecha.getMonth() + 1)
  const hora = dosDigitos(fecha.getHours())
  const minuto = dosDigitos(fecha.getMinutes())
  const segundo = dosDigitos(fecha.getSeconds())
  return `${dia}/${mes}/${fecha.getFullYear()} ${hora}:${minuto}:${segundo}`
}

function escapar(valor: CeldaCsv): string {
  if (valor === null || valor === undefined) return ""
  const texto = typeof valor === "number" ? formatearNumeroCsv(valor) : String(valor)
  // Se entrecomilla solo si hace falta: un archivo con todo entrecomillado se lee peor si
  // alguien lo abre en un editor de texto. Las comillas internas se duplican (RFC 4180).
  if (texto.includes(SEPARADOR) || texto.includes('"') || /[\r\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`
  }
  return texto
}

export function generarCsv(encabezados: string[], filas: CeldaCsv[][]): string {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(escapar).join(SEPARADOR))
  return lineas.join(FIN_DE_LINEA)
}

/**
 * Nombre con el rango exportado y la fecha de generación, para que dos exportaciones del
 * mismo listado no se pisen en la carpeta de descargas.
 *
 * Las fechas del rango van en aaaa-mm-dd (no en dd/mm/aaaa): así los archivos se ordenan
 * cronológicamente solos en el explorador, y la barra no es un carácter válido en un
 * nombre de archivo.
 */
export function nombreArchivoCsv(base: string, desde: string, hasta: string): string {
  const generado = new Date().toISOString().slice(0, 10)
  const rango = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "_completo"
  return `${base}${rango}_generado-${generado}.csv`
}

export function descargarCsv(nombreArchivo: string, contenido: string): void {
  const blob = new Blob([BOM + contenido], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement("a")
  enlace.href = url
  enlace.download = nombreArchivo
  // Hay que adjuntarlo al documento: Firefox ignora el click sobre un <a> que no está en
  // el DOM. Se quita enseguida para no dejar basura en el body.
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  // Sin revoke, el Blob queda retenido hasta que se cierre la pestaña.
  URL.revokeObjectURL(url)
}
