// El ciclo de arrastre con el mouse: mousedown en el elemento, mousemove/mouseup en window
// (T26-200/F-4).
//
// Estaba reimplementado cuatro veces —mover una mesa, mover un sector, redimensionar un
// sector, redimensionar el salón— con el mismo esqueleto en los cuatro: un ref con el punto
// de partida, un efecto que registra y limpia los listeners globales, y el mismo cálculo de
// delta duplicado entre el handler de mousemove y el de mouseup. Lo único que cambiaba era
// qué se acota y a quién se le avisa. Es la lógica con más aristas del canvas (listeners en
// window, limpieza, estado optimista) y corregirla implicaba acertar en cuatro lugares.
//
// Por qué mousemove/mouseup van en `window` y no en el elemento: el mouse se adelanta al
// elemento arrastrado, sobre todo al empezar a moverse rápido. Escuchando en el elemento, el
// arrastre se corta en cuanto el puntero se le escapa; en window sigue hasta que se suelta,
// que es lo que espera cualquiera que haya arrastrado algo.

import { useEffect, useMemo, useRef } from "react"

/**
 * Los dos números que el arrastre mueve.
 *
 * `x` es el que sigue al eje horizontal del mouse y `y` al vertical. Para un arrastre de
 * posición son las coordenadas; para un resize son el ancho y el alto, que se agrandan
 * moviendo el mouse a la derecha y hacia abajo respectivamente.
 */
export interface ParXY {
  x: number
  y: number
}

interface Opciones {
  /**
   * El valor que corresponde a haberse movido (dx, dy) desde donde arrancó el arrastre.
   *
   * Acá es donde cada llamador acota lo suyo: una mesa a los bordes de su sector, un sector
   * a los del salón, un resize a su mínimo y su máximo. Se la llama con el valor de partida
   * —no con el actual— para que el resultado dependa solo de dónde está el mouse ahora y no
   * de cómo se llegó hasta acá; si acumulara, un clamp intermedio arrastraría el error.
   */
  ajustar: (inicial: ParXY, dx: number, dy: number) => ParXY
  /** En cada mousemove. Es el estado optimista: se ve el movimiento sin esperar al servidor. */
  onMover: (valor: ParXY) => void
  /** Al soltar, ya redondeado a enteros. Es el único que persiste. */
  onSoltar: (valor: ParXY) => void
}

export interface Arrastre {
  /** Arranca el arrastre. `inicial` es el valor de ESTE momento, contra el que se miden los deltas. */
  iniciar: (evento: { clientX: number; clientY: number }, inicial: ParXY) => void
  /**
   * Si hay un arrastre en curso ahora mismo.
   *
   * Sirve para no pisar el estado local con el valor que llega por props a mitad de un
   * arrastre, que se vería como que el elemento "tira para atrás" mientras se lo mueve. Es un
   * ref y no un estado a propósito: leerlo no tiene que provocar un render.
   */
  enCurso: () => boolean
}

export function useArrastre({ ajustar, onMover, onSoltar }: Opciones): Arrastre {
  // Un solo ref para "hay arrastre" y "desde dónde": eran dos (isDragging + dragStart) y
  // cada guard tenía que chequear los dos por si quedaban desincronizados. null es "no hay".
  const inicio = useRef<{ mouseX: number; mouseY: number; valor: ParXY } | null>(null)

  // Las tres funciones se leen desde un ref en vez de entrar en las dependencias del efecto.
  // Son distintas en cada render (son arrow functions inline en el llamador, y `ajustar`
  // además cierra sobre valores que cambian, como el tamaño del salón). Con ellas en las
  // dependencias, el efecto desregistraría y volvería a registrar los listeners de window en
  // cada render, incluso a mitad de un arrastre. Así se registran una sola vez y el evento
  // usa siempre la versión más reciente.
  const opciones = useRef({ ajustar, onMover, onSoltar })
  opciones.current = { ajustar, onMover, onSoltar }

  useEffect(() => {
    const valorEn = (e: MouseEvent, desde: { mouseX: number; mouseY: number; valor: ParXY }) =>
      opciones.current.ajustar(desde.valor, e.clientX - desde.mouseX, e.clientY - desde.mouseY)

    const alMover = (e: MouseEvent) => {
      const desde = inicio.current
      if (!desde) return
      opciones.current.onMover(valorEn(e, desde))
    }

    const alSoltar = (e: MouseEvent) => {
      const desde = inicio.current
      if (!desde) return
      // Se limpia ANTES de avisar: onSoltar dispara la escritura al servidor y, cuando
      // responda, el efecto que sincroniza props con estado local va a querer aplicar el
      // valor nuevo. Si el arrastre siguiera figurando como en curso, ese efecto se lo
      // saltearía y el elemento quedaría dibujado en la posición vieja.
      inicio.current = null
      const valor = valorEn(e, desde)
      // Redondeo solo acá: durante el movimiento los fraccionarios se ven más suaves, pero
      // lo que se persiste son píxeles enteros (las columnas son Integer en el backend).
      opciones.current.onSoltar({ x: Math.round(valor.x), y: Math.round(valor.y) })
    }

    window.addEventListener("mousemove", alMover)
    window.addEventListener("mouseup", alSoltar)
    return () => {
      window.removeEventListener("mousemove", alMover)
      window.removeEventListener("mouseup", alSoltar)
    }
  }, [])

  // Estable entre renders: los dos métodos cierran solo sobre refs, así que devolver un
  // objeto nuevo cada vez obligaría a los llamadores a preocuparse por su identidad.
  return useMemo<Arrastre>(
    () => ({
      iniciar: (evento, inicial) => {
        inicio.current = { mouseX: evento.clientX, mouseY: evento.clientY, valor: inicial }
      },
      enCurso: () => inicio.current !== null,
    }),
    []
  )
}

/** Acota un número a [minimo, maximo]. El caso que más se repite dentro de `ajustar`. */
export function acotar(valor: number, minimo: number, maximo: number): number {
  return Math.min(Math.max(minimo, valor), maximo)
}
