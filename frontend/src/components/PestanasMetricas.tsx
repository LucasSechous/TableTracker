// Pestañas de las cuatro vistas de métricas (T26-205).
//
// Ocupación del salón, Rotación de mesas, Ocupación diaria y Horarios de demanda son
// cuatro rutas y cuatro archivos, pero para el usuario son una sola pregunta: cómo viene
// el negocio. Estando sueltas, pasar de una a otra obligaba a abrir el menú y elegir, y
// antes de eso a saber de antemano cuál de las cuatro contenía lo que se buscaba.
//
// Las rutas NO se tocan. Podrían haberse colapsado en una sola /metricas con un parámetro,
// pero eso rompería los enlaces directos que ya existen, obligaría a reescribir los cuatro
// archivos en uno y dejaría sin efecto las entradas del menú que la suite e2e verifica.
// Con las pestañas apuntando a las rutas de siempre se gana lo que importaba —moverse
// entre las cuatro en un click, y ver que son cuatro caras de lo mismo— sin mover nada de
// lo que ya funciona.
//
// La lista sale de navegacion.ts y no está escrita acá: una métrica nueva aparece en el
// menú y en estas pestañas a la vez, o en ninguna.

import { useLocation, useNavigate } from "react-router-dom"
import type { CSSProperties } from "react"
import { SECCIONES } from "../navegacion"

const METRICAS = SECCIONES.filter((s) => s.grupo === "metricas")

export default function PestanasMetricas() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <div
      role="tablist"
      aria-label="Vistas de métricas"
      className="flex flex-wrap gap-[4px] border-b border-b-slate-200 mb-[20px]"
    >
      {METRICAS.map((seccion) => {
        const Icono = seccion.icono
        const actual = seccion.ruta === pathname
        return (
          <button
            key={seccion.ruta}
            role="tab"
            aria-selected={actual}
            onClick={() => navigate(seccion.ruta)}
            style={{ ...pestana, ...(actual ? pestanaActiva : null) }}
          >
            <Icono size={15} aria-hidden />
            {seccion.etiqueta}
          </button>
        )
      })}
    </div>
  )
}

const pestana: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  minHeight: 40,
  padding: "0 14px",
  border: "none",
  // El borde de abajo existe siempre, transparente, para que activar una pestaña no
  // empuje la fila dos píxeles hacia arriba.
  borderBottom: "2px solid transparent",
  background: "none",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--color-slate-500)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  marginBottom: -1,
}

const pestanaActiva: CSSProperties = {
  color: "var(--color-marca-fuerte)",
  borderBottom: "2px solid var(--color-marca-fuerte)",
}
