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
        // aria-hidden mientras está cerrado: el drawer sigue montado y desplazado fuera de
        // pantalla, así que sin esto un lector de pantalla leería diez destinos invisibles.
        aria-hidden={!abierto}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          maxWidth: 300,
          backgroundColor: "#fff",
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
            borderBottom: "2px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <User size={20} color="#1e293b" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>{user?.nombre ?? ""}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", textTransform: "capitalize" }}>{rol ?? ""}</div>
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
              background: "#f1f5f9",
              borderRadius: 10,
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
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
                    color: "#94a3b8",
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

          <div style={{ height: 1, background: "#e2e8f0", margin: "8px 20px", marginTop: "auto" }} />

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
  color: "#334155",
  cursor: "pointer",
  textAlign: "left",
}

// La sección actual, marcada por tres canales a la vez: fondo, color de texto y la barra
// de la izquierda. La barra es la que sobrevive en escala de grises y para quien no
// distingue el azul del gris.
const itemActivoStyle: CSSProperties = {
  backgroundColor: "#eff6ff",
  color: "#1d4ed8",
  borderLeft: "3px solid #1d4ed8",
}
