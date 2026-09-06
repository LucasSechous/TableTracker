// Bloque visual de un sector del restaurante sobre el canvas del salón.
// En modo edición el bloque completo es arrastrable y redimensionable desde su esquina
// inferior derecha; contiene sus mesas activas como MesaVisual.

import { useState, useEffect, useRef } from "react"
import { Pencil, Trash2 } from "lucide-react"
import type { Sector, Mesa, Modo } from "../types"
import MesaVisual from "./MesaVisual"
import ModalEditarSector from "./ModalEditarSector"
import { sectoresApi, extraerDetalle } from "../services/api"
import { DIAMETRO_MESA } from "../constants"

// Tamaño mínimo de un sector sin mesas, para evitar que el resize lo colapse a 0.
const TAMANO_MINIMO_SECTOR = 80

interface SectorBloqueProps {
  sector: Sector
  modo: Modo
  anchoSalon: number
  altoSalon: number
  /** Umbral de limpieza demorada, solo de paso hacia MesaVisual (T26-173). */
  umbralLimpiezaMinutos?: number | null
  onMesaClick: (mesa: Mesa) => void
  onMesaPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onSectorDrag: (sectorId: number, pos_x: number, pos_y: number) => void
  onSectorResize: (sectorId: number, ancho: number, alto: number) => void
  onSectorActualizado: (sector: Sector) => void
  onSectorEliminado: (sectorId: number) => void
  onMesaEliminada: (mesaId: number) => void
}

export default function SectorBloque({
  sector,
  modo,
  anchoSalon,
  altoSalon,
  umbralLimpiezaMinutos,
  onMesaClick,
  onMesaPosicionChange,
  onSectorDrag,
  onSectorResize,
  onSectorActualizado,
  onSectorEliminado,
  onMesaEliminada,
}: SectorBloqueProps) {
  const [modalEditarAbierto, setModalEditarAbierto] = useState(false)
  const [eliminando, setEliminando] = useState(false)

  const [localPos, setLocalPos] = useState({ x: sector.pos_x, y: sector.pos_y })
  const isDragging = useRef(false)
  const dragStart = useRef<{ mouseX: number; mouseY: number; sectorX: number; sectorY: number } | null>(null)

  const [localSize, setLocalSize] = useState({ ancho: sector.ancho, alto: sector.alto })
  const isResizing = useRef(false)
  const resizeStart = useRef<{ mouseX: number; mouseY: number; ancho: number; alto: number } | null>(null)

  useEffect(() => {
    if (!isDragging.current) {
      setLocalPos({ x: sector.pos_x, y: sector.pos_y })
    }
  }, [sector.pos_x, sector.pos_y])

  useEffect(() => {
    if (!isResizing.current) {
      setLocalSize({ ancho: sector.ancho, alto: sector.alto })
    }
  }, [sector.ancho, sector.alto])

  useEffect(() => {
    // Piso en 0 y techo en (dimensión del canvas - dimensión del sector), para que el
    // bloque no pueda arrastrarse fuera de ninguno de los 4 bordes del canvas. El
    // Math.max(0, ...) externo cubre el caso límite de un sector más grande que el canvas.
    const clampX = (valor: number) => Math.min(Math.max(0, valor), Math.max(0, anchoSalon - sector.ancho))
    const clampY = (valor: number) => Math.min(Math.max(0, valor), Math.max(0, altoSalon - sector.alto))

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      setLocalPos({
        x: clampX(dragStart.current.sectorX + dx),
        y: clampY(dragStart.current.sectorY + dy),
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return
      isDragging.current = false
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      const nuevaX = clampX(dragStart.current.sectorX + dx)
      const nuevaY = clampY(dragStart.current.sectorY + dy)
      dragStart.current = null
      onSectorDrag(sector.id, Math.round(nuevaX), Math.round(nuevaY))
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [sector.id, sector.ancho, sector.alto, anchoSalon, altoSalon, onSectorDrag])

  useEffect(() => {
    // El mínimo es el espacio que ocupan las mesas activas (para no dejarlas fuera del
    // sector al achicar); el máximo es lo que queda de canvas desde la posición actual
    // del sector (para no sacarlo del canvas al agrandar), igual que el clamp de arriba
    // pero aplicado a tamaño en vez de posición.
    const mesasActivas = sector.mesas?.filter((m) => m.activa) ?? []
    const minAncho = mesasActivas.length
      ? Math.max(...mesasActivas.map((m) => m.pos_x + DIAMETRO_MESA))
      : TAMANO_MINIMO_SECTOR
    const minAlto = mesasActivas.length
      ? Math.max(...mesasActivas.map((m) => m.pos_y + DIAMETRO_MESA))
      : TAMANO_MINIMO_SECTOR
    const maxAncho = Math.max(minAncho, anchoSalon - sector.pos_x)
    const maxAlto = Math.max(minAlto, altoSalon - sector.pos_y)

    const clampAncho = (valor: number) => Math.min(Math.max(minAncho, valor), maxAncho)
    const clampAlto = (valor: number) => Math.min(Math.max(minAlto, valor), maxAlto)

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
      onSectorResize(sector.id, Math.round(nuevoAncho), Math.round(nuevoAlto))
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [sector.id, sector.pos_x, sector.pos_y, sector.mesas, anchoSalon, altoSalon, onSectorResize])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (modo !== "edicion") return
    isDragging.current = true
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, sectorX: sector.pos_x, sectorY: sector.pos_y }
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (modo !== "edicion") return
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = true
    resizeStart.current = { mouseX: e.clientX, mouseY: e.clientY, ancho: localSize.ancho, alto: localSize.alto }
  }

  async function handleEliminarClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(`¿Eliminar el sector "${sector.nombre}"?`)) return
    setEliminando(true)
    try {
      await sectoresApi.actualizar(sector.id, { activo: false })
      onSectorEliminado(sector.id)
    } catch (err) {
      alert(extraerDetalle(err, "No se pudo eliminar el sector"))
    } finally {
      setEliminando(false)
    }
  }

  return (
    <>
      <div
        // Ancla estable para los tests: el nombre del sector aparece además en la barra
        // de filtros de SalonCanvas, así que buscarlo por texto matchea dos elementos.
        data-testid={`sector-bloque-${sector.nombre}`}
        style={{
          position: "absolute",
          left: localPos.x,
          top: localPos.y,
          width: localSize.ancho,
          height: localSize.alto,
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

        {modo === "edicion" && (
          <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 4, zIndex: 3 }}>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setModalEditarAbierto(true)}
              title="Editar sector"
              style={{
                width: 20,
                height: 20,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #ccc",
                borderRadius: 4,
                backgroundColor: "#fff",
                cursor: "pointer",
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleEliminarClick}
              disabled={eliminando}
              title="Eliminar sector"
              style={{
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
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}

        {sector.mesas
          ?.filter((m) => m.activa)
          .map((mesa) => (
            <MesaVisual
              key={mesa.id}
              mesa={mesa}
              modo={modo}
              anchoSector={localSize.ancho}
              altoSector={localSize.alto}
              umbralLimpiezaMinutos={umbralLimpiezaMinutos}
              onMesaClick={onMesaClick}
              onPosicionChange={onMesaPosicionChange}
              onMesaEliminada={onMesaEliminada}
            />
          ))}

        {modo === "edicion" && (
          <div
            onMouseDown={handleResizeMouseDown}
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 12,
              height: 12,
              cursor: "nwse-resize",
              backgroundColor: "#999",
              borderTopLeftRadius: 4,
              zIndex: 3,
            }}
          />
        )}
      </div>

      {modalEditarAbierto && (
        <ModalEditarSector
          sector={sector}
          onClose={() => setModalEditarAbierto(false)}
          onSectorActualizado={(sectorActualizado) => {
            onSectorActualizado(sectorActualizado)
            setModalEditarAbierto(false)
          }}
        />
      )}
    </>
  )
}
