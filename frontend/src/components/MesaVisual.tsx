// Representación visual de una mesa como círculo coloreado sobre el canvas del salón.
// En modo monitoreo muestra un select inline al hacer click; en modo edición es arrastrable.

import { useState, useEffect, useRef } from "react"
import type { AxiosError } from "axios"
import type { Mesa, Modo } from "../types"
import { mesasApi } from "../services/api"
import { DIAMETRO_MESA, COLOR_POR_ESTADO } from "../constants"

interface MesaVisualProps {
  mesa: Mesa
  modo: Modo
  anchoSector: number
  altoSector: number
  onEstadoChange: (mesaId: number, nuevoEstado: string) => void
  onPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onMesaActualizada: (mesa: Mesa) => void
}

export default function MesaVisual({
  mesa,
  modo,
  anchoSector,
  altoSector,
  onEstadoChange,
  onPosicionChange,
  onMesaActualizada,
}: MesaVisualProps) {
  const [mostrarSelect, setMostrarSelect] = useState(false)
  const [confirmandoLimpieza, setConfirmandoLimpieza] = useState(false)
  const [marcandoReservada, setMarcandoReservada] = useState(false)
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
    setMostrarSelect((v) => !v)
  }

  async function handleConfirmarLimpieza(e: React.MouseEvent) {
    e.stopPropagation()
    setConfirmandoLimpieza(true)
    try {
      const { data } = await mesasApi.confirmarLimpieza(mesa.id)
      onMesaActualizada(data)
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>
      alert(axiosErr.response?.data?.detail ?? "No se pudo confirmar la limpieza de la mesa")
    } finally {
      setConfirmandoLimpieza(false)
    }
  }

  async function handleMarcarReservada(e: React.MouseEvent) {
    e.stopPropagation()
    setMarcandoReservada(true)
    try {
      const { data } = await mesasApi.marcarReservada(mesa.id)
      onMesaActualizada(data)
      setMostrarSelect(false)
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>
      alert(axiosErr.response?.data?.detail ?? "No se pudo marcar la mesa como reservada")
    } finally {
      setMarcandoReservada(false)
    }
  }

  return (
    <div style={{ position: "absolute", left: localPos.x, top: localPos.y }}>
      <div
        style={{
          width: DIAMETRO_MESA,
          height: DIAMETRO_MESA,
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

      {modo === "monitoreo" && mesa.estado === "pendiente_limpieza" && (
        <button
          onClick={handleConfirmarLimpieza}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={confirmandoLimpieza}
          style={{
            position: "absolute",
            top: 15,
            left: 68,
            zIndex: 3,
            padding: "4px 8px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "#4caf50",
            color: "white",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
            cursor: confirmandoLimpieza ? "default" : "pointer",
            opacity: confirmandoLimpieza ? 0.6 : 1,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        >
          {confirmandoLimpieza ? "Confirmando..." : "Confirmar limpieza"}
        </button>
      )}

      {mostrarSelect && (
        <div
          style={{
            position: "absolute",
            top: 64,
            left: 0,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {mesa.estado !== "reservada" && (
            <button
              onClick={handleMarcarReservada}
              disabled={marcandoReservada}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "none",
                backgroundColor: "#2196f3",
                color: "white",
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
                cursor: marcandoReservada ? "default" : "pointer",
                opacity: marcandoReservada ? 0.6 : 1,
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
            >
              {marcandoReservada ? "Reservando..." : "Marcar como reservada"}
            </button>
          )}

          <select
            value={mesa.estado}
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
        </div>
      )}
    </div>
  )
}
