// Menú lateral de navegación: misma mecánica (overlay + drawer deslizante) que
// PanelMesa. Agrupa la navegación de la app para que el header principal quede
// liviano (solo nombre, leyenda y las dos acciones de mayor jerarquía).

import { User, History, PieChart, Camera, Crosshair, LogOut } from "lucide-react"
import type { CSSProperties } from "react"

interface Props {
  abierto: boolean
  nombre: string
  rol: string
  esAdmin: boolean
  onClose: () => void
  onVerHistorial: () => void
  onVerOcupacion: () => void
  onCamaras: () => void
  onCalibrarRoi: () => void
  onLogout: () => void
}

export default function MenuLateral({
  abierto,
  nombre,
  rol,
  esAdmin,
  onClose,
  onVerHistorial,
  onVerOcupacion,
  onCamaras,
  onCalibrarRoi,
  onLogout,
}: Props) {
  function ir(accion: () => void) {
    accion()
    onClose()
  }

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
      <div
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
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>{nombre}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", textTransform: "capitalize" }}>{rol}</div>
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
          <button onClick={() => ir(onVerHistorial)} style={itemStyle}>
            <History size={18} />
            Ver historial
          </button>
          {/* Sin gate de esAdmin, agrupado con "Ver historial": las dos son vistas de
              consulta que sirven a cualquier rol, a diferencia de las de configuración. */}
          <button onClick={() => ir(onVerOcupacion)} style={itemStyle}>
            <PieChart size={18} />
            Ocupación del salón
          </button>
          {esAdmin && (
            <button onClick={() => ir(onCamaras)} style={itemStyle}>
              <Camera size={18} />
              Cámaras
            </button>
          )}
          {esAdmin && (
            <button onClick={() => ir(onCalibrarRoi)} style={itemStyle}>
              <Crosshair size={18} />
              Calibrar ROI
            </button>
          )}

          <div style={{ height: 1, background: "#e2e8f0", margin: "8px 20px", marginTop: "auto" }} />

          <button onClick={() => ir(onLogout)} style={{ ...itemStyle, color: "#ef4444" }}>
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      </div>
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
  background: "none",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "inherit",
  color: "#334155",
  cursor: "pointer",
  textAlign: "left",
}
