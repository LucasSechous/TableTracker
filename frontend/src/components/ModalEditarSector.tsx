// Modal de edición de un sector existente del salón.
// Overlay + card centrada con CSS plano inline, sin librerías externas de UI/modales.

import { useState } from "react"
import type { Sector } from "../types"
import { sectoresApi, extraerDetalle } from "../services/api"

interface ModalEditarSectorProps {
  sector: Sector
  onClose: () => void
  onSectorActualizado: (sector: Sector) => void
}

export default function ModalEditarSector({ sector, onClose, onSectorActualizado }: ModalEditarSectorProps) {
  const [nombre, setNombre] = useState(sector.nombre)
  const [descripcion, setDescripcion] = useState(sector.descripcion ?? "")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirmar() {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) {
      setError("El nombre del sector es obligatorio")
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const { data } = await sectoresApi.actualizar(sector.id, {
        nombre: nombreLimpio,
        descripcion: descripcion.trim() || undefined,
      })
      onSectorActualizado({ ...sector, ...data })
    } catch (err) {
      setError(extraerDetalle(err, "No se pudo actualizar el sector"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: 24,
          width: 360,
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", margin: "0 0 16px" }}>
          Editar sector
        </h2>

        {error && (
          <p
            style={{
              fontSize: 13,
              color: "#c62828",
              backgroundColor: "#ffebee",
              border: "1px solid #ef9a9a",
              borderRadius: 6,
              padding: "8px 12px",
              margin: "0 0 12px",
            }}
          >
            {error}
          </p>
        )}

        <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 12 }}>
          Nombre
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoFocus
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              marginTop: 4,
              padding: 8,
              fontSize: 14,
              border: "1px solid #ccc",
              borderRadius: 6,
            }}
          />
        </label>

        <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 20 }}>
          Descripción (opcional)
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              marginTop: 4,
              padding: 8,
              fontSize: 14,
              border: "1px solid #ccc",
              borderRadius: 6,
              minHeight: 60,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            disabled={guardando}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #ccc",
              fontSize: 13,
              cursor: guardando ? "default" : "pointer",
              backgroundColor: "#fff",
              color: "#555",
              fontWeight: 500,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={guardando}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 13,
              cursor: guardando ? "default" : "pointer",
              backgroundColor: "#1976d2",
              color: "#fff",
              fontWeight: 500,
              opacity: guardando ? 0.6 : 1,
            }}
          >
            {guardando ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  )
}
