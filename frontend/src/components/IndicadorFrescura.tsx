// Qué tan viejo es el dato que se está mirando (T26-205).
//
// El salón se repinta solo cada 3 segundos y, ante un fallo de red, el refresco calla y
// reintenta en el próximo tick. Eso está bien como política —un corte puntual se resuelve
// solo y un cartel rojo por cada uno sería ruido— pero deja el peor modo de falla posible
// para este producto: si la red se cae de verdad, la pantalla sigue mostrando las mesas de
// hace diez minutos con exactamente la misma confianza que si fueran de hace tres segundos.
// No se ve como un error, se ve como un salón tranquilo. Alguien puede sentar gente en una
// mesa que hace rato dejó de estar libre.
//
// Este indicador no arregla el corte: lo hace visible. Mientras todo va bien es una línea
// gris que nadie necesita leer; cuando el dato se estanca pasa a ámbar y dice hace cuánto.
//
// El umbral no es un número inventado: sale del propio intervalo de refresco. Con 3s de
// cadencia, cinco ciclos perdidos son 15 segundos, que ya no se explican por un tick lento
// ni por una request que tardó. Si mañana el intervalo cambia, el umbral lo sigue.

import { useEffect, useState } from "react"
import { TriangleAlert } from "lucide-react"
import type { CSSProperties } from "react"

// Cuántos ciclos de refresco se pueden perder antes de dar el dato por estancado.
const CICLOS_TOLERADOS = 5

interface Props {
  /** Momento (Date.now()) del último refresco exitoso, o null si todavía no hubo ninguno. */
  ultimoExito: number | null
  /** Cadencia esperada del refresco, en milisegundos. De acá sale el umbral. */
  intervaloMs: number
  /**
   * El refresco está detenido a propósito y no por un fallo (el modo edición lo corta para
   * no pisar una mesa que se está arrastrando). Sin esto el indicador acusaría un problema
   * que no existe justo cuando el usuario está trabajando.
   */
  pausado?: boolean
}

export default function IndicadorFrescura({ ultimoExito, intervaloMs, pausado = false }: Props) {
  // El texto dice "hace 4s", así que tiene que recalcularse aunque no llegue ningún dato
  // nuevo: es precisamente cuando NO llega que este componente importa.
  const [, tick] = useState(0)
  useEffect(() => {
    if (pausado) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [pausado])

  if (pausado) {
    return (
      <span
        data-testid="indicador-frescura"
        style={{ ...base, color: "#94a3b8" }}
        title="El salón no se actualiza mientras se edita la disposición"
      >
        Actualización en pausa
      </span>
    )
  }

  if (ultimoExito === null) {
    return (
      <span data-testid="indicador-frescura" style={{ ...base, color: "#94a3b8" }}>
        Conectando…
      </span>
    )
  }

  const segundos = Math.max(0, Math.round((Date.now() - ultimoExito) / 1000))
  const vencido = Date.now() - ultimoExito > intervaloMs * CICLOS_TOLERADOS

  return (
    <span
      data-testid="indicador-frescura"
      style={{ ...base, color: vencido ? "#b45309" : "#94a3b8" }}
      title={
        vencido
          ? "El salón dejó de recibir datos. Lo que se ve puede no reflejar el estado real de las mesas."
          : "El salón se actualiza solo cada pocos segundos"
      }
    >
      {vencido && <TriangleAlert size={14} aria-hidden style={{ flexShrink: 0 }} />}
      {/* aria-hidden en el contador: si se anunciara, un lector de pantalla leería el
          número nuevo cada segundo y taparía todo lo demás. Lo que sí hay que anunciar es
          el cambio de estado, y de eso se encarga la región de abajo. */}
      <span aria-hidden>
        {vencido ? "Sin actualizar hace " : "Actualizado hace "}
        {textoEdad(segundos)}
      </span>

      {/* Solo cambia de contenido cuando el dato pasa a estancado (o se recupera), así que
          se anuncia una vez y no en cada tick. */}
      <span role="status" style={soloParaLectores}>
        {vencido ? "El salón dejó de actualizarse" : ""}
      </span>
    </span>
  )
}

function textoEdad(segundos: number): string {
  if (segundos < 60) return `${segundos}s`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `${minutos} min`
  return `${Math.floor(minutos / 60)} h`
}

const base: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
}

// Fuera de la vista pero dentro del árbol de accesibilidad. No se usa display:none ni
// visibility:hidden porque los dos sacan el nodo de ese árbol y el anuncio no llegaría.
const soloParaLectores: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
}
