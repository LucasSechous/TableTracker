// Modal de edición de un sector existente del salón.
// El overlay, la caja y los botones los pone <Modal> (T26-200/F-3); acá queda solo el formulario.

import { useState } from "react"
import type { Sector } from "../types"
import { sectoresApi, extraerDetalle } from "../services/api"
import Modal from "./Modal"

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
      setError(await extraerDetalle(err, "No se pudo actualizar el sector"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Editar sector"
      error={error}
      ocupado={guardando}
      etiquetaConfirmar={guardando ? "Guardando..." : "Guardar cambios"}
      onConfirmar={handleConfirmar}
      onCancelar={onClose}
    >
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
    </Modal>
  )
}
