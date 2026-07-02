// Representación visual de una mesa como círculo coloreado sobre el canvas del salón.
// En modo monitoreo muestra un select inline al hacer click; en modo edición es arrastrable.

import { useState, useEffect, useRef } from "react"
import type { Mesa, Modo } from "../types"

const COLOR_POR_ESTADO: Record<string, string> = {
  libre: "#4caf50",
  ocupada: "#f44336",
  pendiente_limpieza: "#ff9800",
  reservada: "#2196f3",
}

interface MesaVisualProps {
  mesa: Mesa
  modo: Modo
  onEstadoChange: (mesaId: number, nuevoEstado: string) => void
  onPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
}

export default function MesaVisual({ mesa, modo, onEstadoChange, onPosicionChange }: MesaVisualProps) {
  const [mostrarSelect, setMostrarSelect] = useState(false)
  const [localPos, setLocalPos] = useState({ x: mesa.pos_x, y: mesa.pos_y })
  const isDragging = useRef(false)
  const dragStart = useRef<{ mouseX: number; mouseY: number; mesaX: number; mesaY: number } | null>(null)

  useEffect(() => {
    if (!isDragging.current) {
      setLocalPos({ x: mesa.pos_x, y: mesa.pos_y })
    }
  }, [mesa.pos_x, mesa.pos_y])

  useEffect(() => {
    if (!mostrarSelect) return
    const close = () => setMostrarSelect(false)
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [mostrarSelect])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      setLocalPos({
        x: Math.max(0, dragStart.current.mesaX + dx),
        y: Math.max(0, dragStart.current.mesaY + dy),
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      isDragging.current = false
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      const nuevaX = Math.max(0, dragStart.current.mesaX + dx)
      const nuevaY = Math.max(0, dragStart.current.mesaY + dy)
      dragStart.current = null
      onPosicionChange(mesa.id, Math.round(nuevaX), Math.round(nuevaY))
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [mesa.id, onPosicionChange])

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
    setMostrarSelect((v) => !v)
  }

  return (
    <div style={{ position: "absolute", left: localPos.x, top: localPos.y }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          backgroundColor: COLOR_POR_ESTADO[mesa.estado] ?? "#9e9e9e",
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

      {mostrarSelect && (
        <select
          style={{ position: "absolute", top: 64, left: 0, zIndex: 10 }}
          value={mesa.estado}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            onEstadoChange(mesa.id, e.target.value)
            setMostrarSelect(false)
          }}
        >
          <option value="libre">Libre</option>
          <option value="ocupada">Ocupada</option>
          <option value="pendiente_limpieza">Pendiente de limpieza</option>
          <option value="reservada">Reservada</option>
        </select>
      )}
    </div>
  )
}
