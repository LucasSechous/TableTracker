// Representación visual de una mesa como círculo coloreado sobre el canvas del salón.
// En modo monitoreo el click abre PanelMesa con el detalle; en modo edición es arrastrable.

import { useState, useEffect, useRef } from "react"
import type { AxiosError } from "axios"
import { Trash2 } from "lucide-react"
import type { Mesa, Modo } from "../types"
import { mesasApi } from "../services/api"
import { DIAMETRO_MESA, COLOR_POR_ESTADO, BORDE_POR_ESTADO } from "../constants"

interface MesaVisualProps {
  mesa: Mesa
  modo: Modo
  anchoSector: number
  altoSector: number
  onMesaClick: (mesa: Mesa) => void
  onPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onMesaEliminada: (mesaId: number) => void
}

export default function MesaVisual({
  mesa,
  modo,
  anchoSector,
  altoSector,
  onMesaClick,
  onPosicionChange,
  onMesaEliminada,
}: MesaVisualProps) {
  const [eliminando, setEliminando] = useState(false)
  const [localPos, setLocalPos] = useState({ x: mesa.pos_x, y: mesa.pos_y })
  const isDragging = useRef(false)
  const dragStart = useRef<{ mouseX: number; mouseY: number; mesaX: number; mesaY: number } | null>(null)

  useEffect(() => {
    if (!isDragging.current) {
      setLocalPos({ x: mesa.pos_x, y: mesa.pos_y })
    }
  }, [mesa.pos_x, mesa.pos_y])

  useEffect(() => {
    // Piso en 0 y techo en (dimensión del sector - diámetro de la mesa), para que el
    // círculo no pueda arrastrarse fuera de ninguno de los 4 bordes del sector. El
    // Math.max(0, ...) externo cubre el caso límite de un sector más chico que la mesa.
    const clampX = (valor: number) => Math.min(Math.max(0, valor), Math.max(0, anchoSector - DIAMETRO_MESA))
    const clampY = (valor: number) => Math.min(Math.max(0, valor), Math.max(0, altoSector - DIAMETRO_MESA))

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      setLocalPos({
        x: clampX(dragStart.current.mesaX + dx),
        y: clampY(dragStart.current.mesaY + dy),
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      isDragging.current = false
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      const nuevaX = clampX(dragStart.current.mesaX + dx)
      const nuevaY = clampY(dragStart.current.mesaY + dy)
      dragStart.current = null
      onPosicionChange(mesa.id, Math.round(nuevaX), Math.round(nuevaY))
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [mesa.id, onPosicionChange, anchoSector, altoSector])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (modo !== "edicion") return
    e.preventDefault()
    e.stopPropagation()
    isDragging.current = true
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, mesaX: localPos.x, mesaY: localPos.y }
  }

  const handleClick = (e: React.MouseEvent) => {
    if (modo !== "monitoreo") return
    e.stopPropagation()
    onMesaClick(mesa)
  }

  async function handleEliminarClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(`¿Eliminar la mesa ${mesa.numero}?`)) return
    setEliminando(true)
    try {
      await mesasApi.desactivar(mesa.id)
      onMesaEliminada(mesa.id)
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>
      alert(axiosErr.response?.data?.detail ?? "No se pudo eliminar la mesa")
    } finally {
      setEliminando(false)
    }
  }

  return (
    <div style={{ position: "absolute", left: localPos.x, top: localPos.y }}>
      <div
        style={{
          width: DIAMETRO_MESA,
          height: DIAMETRO_MESA,
          borderRadius: 8,
          border: `2px solid ${BORDE_POR_ESTADO[mesa.estado] ?? "#757575"}`,
          backgroundColor: COLOR_POR_ESTADO[mesa.estado] ?? "#9e9e9e",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "bold",
          fontSize: 16,
          cursor: modo === "edicion" ? "grab" : "pointer",
          userSelect: "none",
          position: "relative",
          zIndex: 2,
        }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        {mesa.numero}
      </div>

      {modo === "edicion" && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleEliminarClick}
          disabled={eliminando}
          title="Eliminar mesa"
          style={{
            position: "absolute",
            top: -6,
            left: 44,
            width: 20,
            height: 20,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid #ccc",
            borderRadius: 4,
            backgroundColor: "#fff",
            cursor: eliminando ? "default" : "pointer",
            opacity: eliminando ? 0.6 : 1,
            zIndex: 3,
          }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}
