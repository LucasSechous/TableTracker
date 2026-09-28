// El botón de la aplicación (T26-205).
//
// Antes cada pantalla declaraba el suyo: `estiloBoton` estaba escrito nueve veces,
// `estiloBotonPrimario` siete y `estiloBotonPeligro` dos. No eran copias idénticas y ahí
// estaba el problema — el `estiloBoton` de ConfiguracionPage tenía minHeight 44,
// fontFamily heredada y whiteSpace nowrap, y el de CamarasPage, con el mismo nombre, no
// tenía ninguno de los tres. Tocar un botón en una pantalla dejaba a las otras ocho
// distintas, que es la razón mecánica de que la interfaz se viera despareja.
//
// Las variantes reproducen los estilos que ya existían, tomando como base la versión de
// ConfiguracionPage, que era la más evolucionada. La correspondencia con los nombres
// viejos, para poder seguir la migración:
//
//   primario   <- estiloBotonPrimario    (azul lleno, la acción principal)
//   secundario <- estiloBoton            (azul con borde, el más usado: es el default)
//   neutro     <- estiloBotonSecundario  (gris con borde, para cancelar o restar énfasis)
//   peligro    <- estiloBotonPeligro     (rojo con borde, para lo destructivo)
//
// Dos cosas que el estilo inline no podía dar y acá aparecen solas en toda la app: el
// hover —un objeto style no admite :hover, así que hasta ahora ningún botón respondía al
// pasar el mouse— y el minHeight de 44px en todos, que es el tamaño mínimo para tocar algo
// con el dedo sin errarle.

import { useState } from "react"
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

export type VarianteBoton = "primario" | "secundario" | "neutro" | "peligro"

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variante?: VarianteBoton
  /** Icono a la izquierda del texto. Decorativo: el botón se entiende sin él. */
  icono?: LucideIcon
  /**
   * Acción en curso. Deshabilita el botón —para que no se dispare dos veces— y lo marca
   * con aria-busy, que es lo que un lector de pantalla necesita para anunciar la espera.
   */
  cargando?: boolean
  /** Texto mientras `cargando`. Si no se pasa, el botón conserva el suyo. */
  textoCargando?: ReactNode
  children?: ReactNode
}

const BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  // 44px es el mínimo táctil: abajo de eso, en un celular, se le erra al botón.
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  // Sin esto el botón sale con la fuente del sistema y no con la de la app: los <button>
  // no heredan font-family, y era la causa de que los botones se vieran de otra familia
  // que el texto de al lado.
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease",
}

// Cada variante en dos estados. El de hover es un escalón del mismo tono y no un color
// nuevo: lo que tiene que comunicar es "esto responde", no otra categoría.
const VARIANTES: Record<VarianteBoton, { normal: CSSProperties; hover: CSSProperties }> = {
  primario: {
    normal: { border: "none", backgroundColor: "var(--marca)", color: "var(--blanco)", fontWeight: 600 },
    hover: { backgroundColor: "#1565c0" },
  },
  secundario: {
    normal: { border: "1px solid var(--marca)", backgroundColor: "var(--blanco)", color: "var(--marca)" },
    hover: { backgroundColor: "#e3f2fd" },
  },
  neutro: {
    normal: { border: "1px solid var(--gris-250)", backgroundColor: "var(--blanco)", color: "var(--gris-700)" },
    hover: { backgroundColor: "var(--gris-75)", borderColor: "var(--gris-350)" },
  },
  peligro: {
    normal: { border: "1px solid var(--error)", backgroundColor: "var(--blanco)", color: "var(--error)" },
    hover: { backgroundColor: "var(--error-fondo)" },
  },
}

export default function Boton({
  variante = "secundario",
  icono: Icono,
  cargando = false,
  textoCargando,
  children,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  ...resto
}: Props) {
  const [hover, setHover] = useState(false)

  // Un botón cargando está deshabilitado aunque nadie lo pida: si no, el segundo click
  // manda la misma request otra vez, que es exactamente lo que el estado quiere evitar.
  const inactivo = disabled || cargando
  const { normal, hover: estiloHover } = VARIANTES[variante]

  return (
    <button
      {...resto}
      disabled={inactivo}
      aria-busy={cargando || undefined}
      onMouseEnter={(e) => {
        setHover(true)
        onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        setHover(false)
        onMouseLeave?.(e)
      }}
      style={{
        ...BASE,
        ...normal,
        ...(hover && !inactivo ? estiloHover : null),
        ...(inactivo ? { opacity: 0.6, cursor: "not-allowed" } : null),
        // El style que llega por props va último para que una pantalla pueda ajustar un
        // caso puntual (un flex: 1, un margen) sin tener que volver a escribir el botón.
        ...style,
      }}
    >
      {Icono && <Icono size={16} aria-hidden />}
      {cargando && textoCargando !== undefined ? textoCargando : children}
    </button>
  )
}
