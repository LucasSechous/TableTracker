// Menú lateral de navegación: overlay + drawer deslizante, misma mecánica que PanelMesa.
//
// Hasta T26-205 recibía diez callbacks (onVerHistorial, onCamaras, onConfiguracion...) y
// los diez los cableaba DashboardPage. Eso ataba el menú a una pantalla: era la única que
// sabía armarlo, así que era la única que lo tenía, y desde las otras nueve la única
// salida era un botón "Volver al salón". Moverse entre dos secciones obligaba a pasar por
// el salón —ir de Cámaras a Usuarios eran tres pasos— y en ningún lado se veía dónde
// estaba uno parado.
//
// Ahora el menú navega solo, recorriendo la tabla de navegacion.ts, y lo monta Layout, que
// envuelve a todas las pantallas. Sin props de navegación no hay nada que cablear, que es
// lo que permitió sacarlo del Dashboard.

import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { User, LogOut } from "lucide-react"
import type { CSSProperties } from "react"
import { useAuth } from "../hooks/useAuth"
import { esAdmin as rolEsAdmin } from "../permisos"
import { GRUPOS, SECCIONES, TITULO_GRUPO } from "../navegacion"

interface Props {
  abierto: boolean
  onClose: () => void
}

export default function MenuLateral({ abierto, onClose }: Props) {
  const { user, rol } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const esAdmin = rolEsAdmin(rol)

  // Escape cierra el drawer. Un panel que tapa la pantalla y solo se cierra apuntándole a
  // la × o al overlay obliga a usar el mouse para deshacer algo que se abrió sin querer.
  useEffect(() => {
    if (!abierto) return
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", alTeclear)
    return () => window.removeEventListener("keydown", alTeclear)
  }, [abierto, onClose])

  function ir(ruta: string) {
    navigate(ruta)
    onClose()
  }

  function salir() {
    localStorage.removeItem("token")
    navigate("/login")
    onClose()
  }

  const visibles = SECCIONES.filter((s) => !s.soloAdmin || esAdmin)

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.4)",
          zIndex: 200,
          opacity: abierto ? 1 : 0,
          visibility: abierto ? "visible" : "hidden",
          transition: "opacity 0.2s ease",
        }}
      />
      <nav
        aria-label="Navegación principal"
        // inert mientras está cerrado. El drawer no se desmonta —se desplaza fuera de
        // pantalla con un transform, que es lo que permite animarlo—, así que sin esto
        // queda un menú entero operable que nadie ve: un lector de pantalla lee diez
        // destinos invisibles y el tabulador mete el foco adentro, donde el usuario no
        // puede ver dónde está parado.
        //
        // inert y no aria-hidden: aria-hidden lo saca del árbol de accesibilidad pero deja
        // los botones enfocables, que es la peor de las dos mitades —el foco entra en algo
        // que ya no se anuncia—. inert hace las dos cosas a la vez.
        inert={!abierto}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          maxWidth: 300,
          backgroundColor: "var(--blanco)",
          zIndex: 201,
          transform: abierto ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 20px rgba(0,0,0,0.1)",
        }}
      >
        <div
          style={{
            padding: 20,
            borderBottom: "2px solid var(--slate-200)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {/* El color va por CSS y no por la prop `color`: lucide la vuelca en el atributo
                stroke, y var() no se resuelve en un atributo de presentacion de SVG.
                Sin la prop, lucide usa currentColor, que si lo resuelve. */}
            <User size={20} style={{ color: "var(--slate-900)" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--slate-900)" }}>{user?.nombre ?? ""}</div>
              <div style={{ fontSize: 12, color: "var(--slate-400)", textTransform: "capitalize" }}>{rol ?? ""}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar menú"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              border: "none",
              background: "var(--slate-100)",
              borderRadius: 10,
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--slate-500)",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", padding: "8px 0" }}>
          {GRUPOS.map((grupo) => {
            const delGrupo = visibles.filter((s) => s.grupo === grupo)
            // Un rol no admin no ve ninguna sección de administración: sin esto quedaría
            // el rótulo del grupo solo, encabezando una lista vacía.
            if (delGrupo.length === 0) return null

            return (
              <div key={grupo}>
                <div
                  style={{
                    padding: "10px 20px 4px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    color: "var(--slate-400)",
                  }}
                >
                  {TITULO_GRUPO[grupo]}
                </div>
                {delGrupo.map((seccion) => {
                  const Icono = seccion.icono
                  const actual = seccion.ruta === pathname
                  return (
                    <button
                      key={seccion.ruta}
                      onClick={() => ir(seccion.ruta)}
                      // aria-current es lo que anuncia "estás acá" a un lector de pantalla.
                      // El color y la barra de la izquierda dicen lo mismo para quien ve.
                      aria-current={actual ? "page" : undefined}
                      style={{
                        ...itemStyle,
                        ...(actual ? itemActivoStyle : null),
                      }}
                    >
                      <Icono size={18} aria-hidden />
                      {seccion.etiqueta}
                    </button>
                  )
                })}
              </div>
            )
          })}

          <div style={{ height: 1, background: "var(--slate-200)", margin: "8px 20px", marginTop: "auto" }} />

          <button onClick={salir} style={{ ...itemStyle, color: "#ef4444" }}>
            <LogOut size={18} aria-hidden />
            Cerrar sesión
          </button>
        </div>
      </nav>
    </>
  )
}

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  minHeight: 44,
  padding: "12px 20px",
  border: "none",
  borderLeft: "3px solid transparent",
  background: "none",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "inherit",
  color: "var(--slate-700)",
  cursor: "pointer",
  textAlign: "left",
}

// La sección actual, marcada por tres canales a la vez: fondo, color de texto y la barra
// de la izquierda. La barra es la que sobrevive en escala de grises y para quien no
// distingue el azul del gris.
const itemActivoStyle: CSSProperties = {
  backgroundColor: "var(--marca-tenue)",
  color: "var(--marca-fuerte)",
  borderLeft: "3px solid var(--marca-fuerte)",
}
