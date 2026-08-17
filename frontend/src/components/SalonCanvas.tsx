// Canvas 2D que representa el salón del restaurante con sectores y mesas posicionados.
// Presentacional salvo por el resize de su propio borde (solo admin, en modo edición): mantiene
// un estado local optimista durante el arrastre, igual que SectorBloque con sus sectores.

import { useState, useRef, useEffect } from "react"
import type { Sector, Mesa, Modo } from "../types"
import SectorBloque from "./SectorBloque"

// Tamaño mínimo del salón sin sectores, para evitar que el resize lo colapse a 0.
const TAMANO_MINIMO_SALON = 200

interface Props {
  sectores: Sector[]
  modo: Modo
  anchoSalon: number
  altoSalon: number
  esAdmin: boolean
  onMesaEstadoChange: (mesaId: number, nuevoEstado: string) => void
  onMesaPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onSectorPosicionChange: (sectorId: number, pos_x: number, pos_y: number) => void
  onSectorResize: (sectorId: number, ancho: number, alto: number) => void
  onSectorActualizado: (sector: Sector) => void
  onSectorEliminado: (sectorId: number) => void
  onMesaActualizada: (mesa: Mesa) => void
  onSalonResize: (ancho: number, alto: number) => void
}

export default function SalonCanvas({
  sectores,
  modo,
  anchoSalon,
  altoSalon,
  esAdmin,
  onMesaEstadoChange,
  onMesaPosicionChange,
  onSectorPosicionChange,
  onSectorResize,
  onSectorActualizado,
  onSectorEliminado,
  onMesaActualizada,
  onSalonResize,
}: Props) {
  const puedeRedimensionar = modo === "edicion" && esAdmin

  const [localSize, setLocalSize] = useState({ ancho: anchoSalon, alto: altoSalon })
  const isResizing = useRef(false)
  const resizeStart = useRef<{ mouseX: number; mouseY: number; ancho: number; alto: number } | null>(null)

  useEffect(() => {
    if (!isResizing.current) {
      setLocalSize({ ancho: anchoSalon, alto: altoSalon })
    }
  }, [anchoSalon, altoSalon])

  useEffect(() => {
    // El mínimo es el espacio que ocupan los sectores activos (para no dejarlos fuera del
    // salón al achicar), igual que el mínimo de un sector se calcula a partir de sus mesas.
    // No hay techo: a diferencia de un sector, el salón no vive contenido en nada más.
    const sectoresActivos = sectores.filter((s) => s.activo)
    const minAncho = sectoresActivos.length
      ? Math.max(...sectoresActivos.map((s) => s.pos_x + s.ancho))
      : TAMANO_MINIMO_SALON
    const minAlto = sectoresActivos.length
      ? Math.max(...sectoresActivos.map((s) => s.pos_y + s.alto))
      : TAMANO_MINIMO_SALON

    const clampAncho = (valor: number) => Math.max(minAncho, valor)
    const clampAlto = (valor: number) => Math.max(minAlto, valor)

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !resizeStart.current) return
      const dx = e.clientX - resizeStart.current.mouseX
      const dy = e.clientY - resizeStart.current.mouseY
      setLocalSize({
        ancho: clampAncho(resizeStart.current.ancho + dx),
        alto: clampAlto(resizeStart.current.alto + dy),
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isResizing.current || !resizeStart.current) return
      isResizing.current = false
      const dx = e.clientX - resizeStart.current.mouseX
      const dy = e.clientY - resizeStart.current.mouseY
      const nuevoAncho = clampAncho(resizeStart.current.ancho + dx)
      const nuevoAlto = clampAlto(resizeStart.current.alto + dy)
      resizeStart.current = null
      onSalonResize(Math.round(nuevoAncho), Math.round(nuevoAlto))
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [sectores, onSalonResize])

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (!puedeRedimensionar) return
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = true
    resizeStart.current = { mouseX: e.clientX, mouseY: e.clientY, ancho: localSize.ancho, alto: localSize.alto }
  }

  return (
    <div
      style={{
        position: "relative",
        width: localSize.ancho,
        height: localSize.alto,
        backgroundColor: "#f0f0f0",
        border: "2px solid #ccc",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {sectores.filter((sector) => sector.activo).map((sector) => (
        <SectorBloque
          key={sector.id}
          sector={sector}
          modo={modo}
          anchoSalon={localSize.ancho}
          altoSalon={localSize.alto}
          onMesaEstadoChange={onMesaEstadoChange}
          onMesaPosicionChange={onMesaPosicionChange}
          onSectorDrag={onSectorPosicionChange}
          onSectorResize={onSectorResize}
          onSectorActualizado={onSectorActualizado}
          onSectorEliminado={onSectorEliminado}
          onMesaActualizada={onMesaActualizada}
        />
      ))}

      {puedeRedimensionar && (
        <div
          onMouseDown={handleResizeMouseDown}
          title="Redimensionar salón"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 14,
            height: 14,
            cursor: "nwse-resize",
            backgroundColor: "#1976d2",
            borderTopLeftRadius: 4,
            zIndex: 4,
          }}
        />
      )}
    </div>
  )
}
