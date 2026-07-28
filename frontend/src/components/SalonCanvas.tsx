// Canvas 2D que representa el salón del restaurante con sectores y mesas posicionados.
// Componente puramente presentacional: no mantiene estado propio, delega todo al padre.

import type { Sector, Mesa, Modo } from "../types"
import SectorBloque from "./SectorBloque"

interface Props {
  sectores: Sector[]
  modo: Modo
  onMesaEstadoChange: (mesaId: number, nuevoEstado: string) => void
  onMesaPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onSectorPosicionChange: (sectorId: number, pos_x: number, pos_y: number) => void
  onMesaActualizada: (mesa: Mesa) => void
}

export default function SalonCanvas({
  sectores,
  modo,
  onMesaEstadoChange,
  onMesaPosicionChange,
  onSectorPosicionChange,
  onMesaActualizada,
}: Props) {
  return (
    <div
      style={{
        position: "relative",
        width: 1200,
        height: 700,
        backgroundColor: "#f0f0f0",
        border: "2px solid #ccc",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {sectores.map((sector) => (
        <SectorBloque
          key={sector.id}
          sector={sector}
          modo={modo}
          onMesaEstadoChange={onMesaEstadoChange}
          onMesaPosicionChange={onMesaPosicionChange}
          onSectorDrag={onSectorPosicionChange}
          onMesaActualizada={onMesaActualizada}
        />
      ))}
    </div>
  )
}
