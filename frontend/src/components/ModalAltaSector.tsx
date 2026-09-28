// Modal de alta de un nuevo sector del salón.
// El overlay, la caja y los botones los pone <Modal> (T26-200/F-3); acá queda solo el formulario.

import { useState } from "react"
import type { Sector } from "../types"
import { sectoresApi, extraerDetalle } from "../services/api"
import Modal from "./Modal"

interface ModalAltaSectorProps {
  onClose: () => void
  onSectorCreado: (sector: Sector) => void
}

export default function ModalAltaSector({ onClose, onSectorCreado }: ModalAltaSectorProps) {
  const [nombre, setNombre] = useState("")
  const [descripcion, setDescripcion] = useState("")
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
      const { data } = await sectoresApi.crear({
        nombre: nombreLimpio,
        descripcion: descripcion.trim() || undefined,
      })
      onSectorCreado({ ...data, mesas: [] })
    } catch (err) {
      setError(await extraerDetalle(err, "No se pudo crear el sector"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Nuevo sector"
      error={error}
      ocupado={guardando}
      etiquetaConfirmar={guardando ? "Creando..." : "Crear sector"}
      onConfirmar={handleConfirmar}
      onCancelar={onClose}
    >
      <label className="block text-[13px] text-gris-600 mb-[12px]">
        Nombre
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
          className="block w-full box-border mt-[4px] p-[8px] text-[14px] border border-gris-250 rounded-[6px]"
        />
      </label>

      <label className="block text-[13px] text-gris-600 mb-[20px]">
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
            border: "1px solid var(--color-gris-250)",
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
