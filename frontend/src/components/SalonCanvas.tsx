// Canvas 2D que representa el salón del restaurante con sectores y mesas posicionados.
// Presentacional salvo por el resize de su propio borde (solo admin, en modo edición): mantiene
// un estado local optimista durante el arrastre, igual que SectorBloque con sus sectores.
// El click en una mesa (modo monitoreo) abre PanelMesa con el detalle y la corrección manual
// de estado (RF-17), en vez del selector inline que había antes directamente sobre el canvas.

import { useState, useRef, useEffect } from "react"
import type { CSSProperties } from "react"
import type { Sector, Mesa, Modo } from "../types"
import SectorBloque from "./SectorBloque"
import PanelMesa from "./PanelMesa"
import { COLOR_POR_ESTADO } from "../constants"

// Tamaño mínimo del salón sin sectores, para evitar que el resize lo colapse a 0.
const TAMANO_MINIMO_SALON = 200

// Etiquetas legibles de cada estado para la leyenda de colores.
const ETIQUETA_POR_ESTADO: Record<string, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pendiente_limpieza: "Pendiente de limpieza",
  reservada: "Reservada",
}

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
  onMesaEliminada: (mesaId: number) => void
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
  onMesaEliminada,
  onSalonResize,
}: Props) {
  const puedeRedimensionar = modo === "edicion" && esAdmin

  const [localSize, setLocalSize] = useState({ ancho: anchoSalon, alto: altoSalon })
  const isResizing = useRef(false)
  const resizeStart = useRef<{ mouseX: number; mouseY: number; ancho: number; alto: number } | null>(null)

  const [sectorFiltrado, setSectorFiltrado] = useState<number | null>(null)
  const [mesaSeleccionadaId, setMesaSeleccionadaId] = useState<number | null>(null)

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

  const sectoresActivos = sectores.filter((s) => s.activo)
  const sectoresVisibles =
    sectorFiltrado === null ? sectoresActivos : sectoresActivos.filter((s) => s.id === sectorFiltrado)

  const mesaSeleccionada =
    mesaSeleccionadaId === null
      ? null
      : sectores.flatMap((s) => s.mesas ?? []).find((m) => m.id === mesaSeleccionadaId) ?? null

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 12,
        }}
      >
        {Object.entries(COLOR_POR_ESTADO).map(([estado, color]) => (
          <div key={estado} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                backgroundColor: color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, color: "#475569", fontWeight: 500 }}>
              {ETIQUETA_POR_ESTADO[estado] ?? estado}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          marginBottom: 16,
          paddingBottom: 4,
        }}
      >
        <button onClick={() => setSectorFiltrado(null)} style={estiloTab(sectorFiltrado === null)}>
          Todos
        </button>
        {sectoresActivos.map((sector) => (
          <button
            key={sector.id}
            onClick={() => setSectorFiltrado(sector.id)}
            style={estiloTab(sectorFiltrado === sector.id)}
          >
            {sector.nombre}
          </button>
        ))}
      </div>

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
        {sectoresVisibles.map((sector) => (
          <SectorBloque
            key={sector.id}
            sector={sector}
            modo={modo}
            anchoSalon={localSize.ancho}
            altoSalon={localSize.alto}
            onMesaClick={(mesa) => setMesaSeleccionadaId(mesa.id)}
            onMesaPosicionChange={onMesaPosicionChange}
            onSectorDrag={onSectorPosicionChange}
            onSectorResize={onSectorResize}
            onSectorActualizado={onSectorActualizado}
            onSectorEliminado={onSectorEliminado}
            onMesaEliminada={onMesaEliminada}
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

      <PanelMesa
        mesa={mesaSeleccionada}
        onClose={() => setMesaSeleccionadaId(null)}
        onEstadoChange={onMesaEstadoChange}
        onMesaActualizada={onMesaActualizada}
      />
    </div>
  )
}

function estiloTab(activo: boolean): CSSProperties {
  return {
    padding: "10px 18px",
    minHeight: 44,
    borderRadius: 8,
    border: activo ? "2px solid #1976d2" : "2px solid #cbd5e1",
    backgroundColor: activo ? "#1976d2" : "#fff",
    color: activo ? "#fff" : "#64748b",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  }
}
