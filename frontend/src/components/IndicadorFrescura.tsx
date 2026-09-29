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
  // La edad del dato crece sola, así que hay que recalcularla aunque no llegue nada nuevo:
  // es precisamente cuando NO llega que este componente importa.
  //
  // El tic sigue siendo de un segundo aunque el texto cambie cada diez. Lo que no puede
  // esperar es el paso a "estancado": con un tic de diez segundos, el aviso llegaría hasta
  // diez tarde. El render de más es barato —React no toca el DOM si el texto no cambió— y
  // el aviso llega a tiempo.
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
        style={{ ...base, color: "var(--color-slate-400)" }}
        title="El salón no se actualiza mientras se edita la disposición"
      >
        Actualización en pausa
      </span>
    )
  }

  if (ultimoExito === null) {
    return (
      <span data-testid="indicador-frescura" style={{ ...base, color: "var(--color-slate-400)" }}>
        Conectando…
      </span>
    )
  }

  // Floor y no round: la edad se muestra por tramos ("menos de 20 segundos"), y redondear
  // al segundo más cercano haría que a los 9,6s ya se contara como 10 y saltara al tramo
  // siguiente antes de tiempo. Truncando, la cuenta coincide con lo que dice el cartel.
  const segundos = Math.max(0, Math.floor((Date.now() - ultimoExito) / 1000))
  const vencido = Date.now() - ultimoExito > intervaloMs * CICLOS_TOLERADOS

  return (
    <span
      data-testid="indicador-frescura"
      style={{ ...base, color: vencido ? "var(--color-aviso-fuerte)" : "var(--color-slate-400)" }}
      title={
        vencido
          ? "El salón dejó de recibir datos. Lo que se ve puede no reflejar el estado real de las mesas."
          : "El salón se actualiza solo cada pocos segundos"
      }
    >
      {vencido && <TriangleAlert size={14} aria-hidden className="shrink-0" />}
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

/**
 * La edad del dato, redondeada hacia arriba y dicha como una cota: "menos de 20 segundos".
 *
 * No dice el número exacto a propósito. Un contador que corre de a un segundo invita a
 * mirarlo, y acá no hay nada que mirar: entre 4 y 7 segundos no hay ninguna decisión
 * distinta que tomar. Lo único que importa es de qué lado del umbral está el dato, y para
 * eso alcanza con el tramo. De paso, el cartel deja de moverse cada segundo en un rincón
 * de la pantalla.
 *
 * Se redondea hacia ARRIBA para que la cota nunca mienta a favor: con 12 segundos, decir
 * "menos de 20" es cierto, y decir "menos de 10" sería falso.
 */
function textoEdad(segundos: number): string {
  if (segundos < 60) return `menos de ${aTramo(segundos, 10)} segundos`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `menos de ${minutos + 1} min`
  return `menos de ${Math.floor(minutos / 60) + 1} h`
}

/** El siguiente múltiplo de `paso` estrictamente mayor que `valor`. */
function aTramo(valor: number, paso: number): number {
  return (Math.floor(valor / paso) + 1) * paso
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
