// Selector de rango de fechas (Desde / Hasta), compartido por las pantallas de consulta
// que filtran por período: historial (RF-21) y rotación de mesas (RF-23).
//
// Extraído de HistorialPage, donde vivía inline. Devuelve un fragmento con los dos <label>
// sueltos, no un <div> contenedor: las dos pantallas los ubican como hijos directos de su
// propia barra de filtros (un flex con gap), así que envolverlos cambiaría el layout.
//
// Los <input> van anidados dentro del <label>, sin htmlFor: es la asociación implícita que
// ya usaba HistorialPage y de la que dependen los helpers e2e (getByLabel("Desde")).

import type { CSSProperties } from "react"

interface Props {
  desde: string
  hasta: string
  onDesdeChange: (valor: string) => void
  onHastaChange: (valor: string) => void
}

export default function RangoFechas({ desde, hasta, onDesdeChange, onHastaChange }: Props) {
  return (
    <>
      <label style={labelStyle}>
        Desde
        <input
          type="date"
          data-testid="rango-fechas-desde"
          value={desde}
          onChange={(e) => onDesdeChange(e.target.value)}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Hasta
        <input
          type="date"
          data-testid="rango-fechas-hasta"
          value={hasta}
          onChange={(e) => onHastaChange(e.target.value)}
          style={inputStyle}
        />
      </label>
    </>
  )
}

// Mismo lenguaje visual que el resto de los filtros de HistorialPage, para que el
// componente extraído no se note como un injerto.
export const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  color: "#444",
}

const inputStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #ccc",
}

// El backend interpreta fecha_fin como un instante, así que un "hasta 2026-08-31" a secas
// se leería como las 00:00 de ese día y dejaría afuera todo lo que pasó durante la jornada.
// Se estira al último segundo para que el rango sea inclusivo, que es lo que espera quien
// elige una fecha en el calendario.
export function finDelDia(fecha: string): string {
  return `${fecha}T23:59:59`
}
