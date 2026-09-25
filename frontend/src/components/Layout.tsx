// Marco común de las pantallas autenticadas (T26-205): encabezado fijo + menú lateral.
//
// Hasta ahora cada pantalla escribía su propio <header>: el mismo bloque de nueve líneas,
// copiado diez veces, con un <h1> literal y un botón "Volver al salón". El menú lo montaba
// solo el Dashboard, así que desde las demás no había forma de ir a ningún lado sin pasar
// antes por el salón.
//
// Al vivir el encabezado acá, el menú viene con él: cualquier pantalla envuelta en Layout
// tiene la navegación completa, y el título sale de la tabla de navegacion.ts en vez de
// estar escrito a mano, así que no puede decir una cosa distinta de la que muestra el menú.
//
// El encabezado es position:fixed para las diez pantallas y no solo para el salón. Lo
// descubrió el Dashboard —con un salón grande el encabezado se iba con el scroll— pero
// vale igual en las tablas largas de Historial o Usuarios, y hace que la barra no salte de
// lugar al cambiar de sección.

import { useState } from "react"
import type { ReactNode } from "react"
import { Menu } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import MenuLateral from "./MenuLateral"
import { seccionDe } from "../navegacion"

// Con altura fija se puede compensar el encabezado con un spacer del mismo tamaño en vez
// de medirlo en runtime.
export const ALTURA_HEADER = 68

interface Props {
  children: ReactNode
  /**
   * Acciones propias de la pantalla, a la izquierda del botón de menú. Van acá y no
   * dentro del contenido para que queden siempre visibles junto con el encabezado.
   */
  acciones?: ReactNode
  /** Título alternativo. Por defecto, el de la sección según la ruta actual. */
  titulo?: string
}

export default function Layout({ children, acciones, titulo }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const seccion = seccionDe(pathname)

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 150,
          height: ALTURA_HEADER,
          backgroundColor: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {/* La marca es el camino de vuelta al salón desde cualquier lado, que es lo que
              hacía el botón "Volver al salón" de cada pantalla. Sigue estando además como
              primera entrada del menú: acá es el atajo, allá el destino explícito. */}
          <button
            onClick={() => navigate("/")}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              color: "#94a3b8",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            TABLETRACKER
          </button>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#1a1a1a",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {titulo ?? seccion.etiqueta}
          </h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {acciones}
          <button
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            aria-expanded={menuAbierto}
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              border: "none",
              borderRadius: 10,
              backgroundColor: "#f1f5f9",
              color: "#1a1a1a",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Menu size={20} aria-hidden />
          </button>
        </div>
      </header>

      {/* Compensa el encabezado fijo: sin esto el contenido arrancaría tapado. */}
      <div style={{ height: ALTURA_HEADER }} />

      {children}

      <MenuLateral abierto={menuAbierto} onClose={() => setMenuAbierto(false)} />
    </div>
  )
}
