// Bloque visual de un sector del restaurante sobre el canvas del salón.
// En modo edición el bloque completo es arrastrable; contiene sus mesas activas como MesaVisual.

import { useState, useEffect, useRef } from "react"
import type { Sector, Modo } from "../types"
import MesaVisual from "./MesaVisual"

interface SectorBloqueProps {
  sector: Sector
  modo: Modo
  onMesaEstadoChange: (mesaId: number, nuevoEstado: string) => void
  onMesaPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onSectorDrag: (sectorId: number, pos_x: number, pos_y: number) => void
}

export default function SectorBloque({
  sector,
  modo,
  onMesaEstadoChange,
  onMesaPosicionChange,
  onSectorDrag,
}: SectorBloqueProps) {
  const [localPos, setLocalPos] = useState({ x: sector.pos_x, y: sector.pos_y })
  const isDragging = useRef(false)
  const dragStart = useRef<{ mouseX: number; mouseY: number; sectorX: number; sectorY: number } | null>(null)

  useEffect(() => {
    if (!isDragging.current) {
      setLocalPos({ x: sector.pos_x, y: sector.pos_y })
    }
  }, [sector.pos_x, sector.pos_y])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      setLocalPos({
        x: dragStart.current.sectorX + dx,
        y: dragStart.current.sectorY + dy,
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      isDragging.current = false
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      const nuevaX = Math.max(0, dragStart.current.sectorX + dx)
      const nuevaY = Math.max(0, dragStart.current.sectorY + dy)
      dragStart.current = null
      onSectorDrag(sector.id, Math.round(nuevaX), Math.round(nuevaY))
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [sector.id, onSectorDrag])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (modo !== "edicion") return
    isDragging.current = true
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, sectorX: sector.pos_x, sectorY: sector.pos_y }
  }

  return (
    <div
      style={{
        position: "absolute",
        left: localPos.x,
        top: localPos.y,
        width: sector.ancho,
        height: sector.alto,
        border: "2px solid #999",
        backgroundColor: "rgba(255,255,255,0.85)",
        borderRadius: 6,
        boxSizing: "border-box",
        userSelect: "none",
        cursor: modo === "edicion" ? "grab" : "default",
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 8,
          fontWeight: "bold",
          fontSize: 12,
          color: "#555",
          pointerEvents: "none",
        }}
      >
        {sector.nombre}
      </div>

      {sector.mesas
        ?.filter((m) => m.activa)
        .map((mesa) => (
          <MesaVisual
            key={mesa.id}
            mesa={mesa}
            modo={modo}
            onEstadoChange={onMesaEstadoChange}
            onPosicionChange={onMesaPosicionChange}
          />
        ))}
    </div>
  )
}
