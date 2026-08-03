// Modal de alta de una nueva mesa dentro de un sector del salón.
// La posición inicial se calcula en coordenadas locales al sector (ver nota sobre pos_x/pos_y más abajo).

import { useState } from "react"
import type { AxiosError } from "axios"
import type { Mesa, Sector } from "../types"
import { mesasApi } from "../services/api"
import { DIAMETRO_MESA } from "../constants"

// SectorBloque.tsx posiciona el bloque del sector con position:absolute (creando su propio
// contenedor de posicionamiento) y renderiza cada MesaVisual como hijo absoluto de ese bloque.
// Por eso mesa.pos_x/pos_y son relativos a la esquina del sector, no coordenadas globales del canvas.
// MARGEN es el radio efectivo de la mesa (DIAMETRO_MESA/2) y CELDA suma el diámetro más
// 10px de separación visual entre mesas contiguas de la grilla.
const MARGEN = DIAMETRO_MESA / 2
const CELDA = 70

interface ModalAltaMesaProps {
  sectores: Sector[]
  onClose: () => void
  onMesaCreada: (mesa: Mesa) => void
}

export default function ModalAltaMesa({ sectores, onClose, onMesaCreada }: ModalAltaMesaProps) {
  const [numero, setNumero] = useState("")
  const [sectorId, setSectorId] = useState<number | "">(sectores[0]?.id ?? "")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const haySectores = sectores.length > 0

  async function handleConfirmar() {
    const numeroMesa = Number(numero)
    if (!numero.trim() || !Number.isInteger(numeroMesa) || numeroMesa <= 0) {
      setError("Ingresá un número de mesa válido")
      return
    }
    if (sectorId === "") {
      setError("Seleccioná un sector")
      return
    }
    const sector = sectores.find((s) => s.id === sectorId)
    if (!sector) {
      setError("El sector seleccionado ya no existe")
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const { data: mesaCreada } = await mesasApi.crear({ numero: numeroMesa, sector_id: sector.id })

      // Posición inicial de conveniencia en una grilla acotada a los límites del sector
      // (el usuario puede reacomodar la mesa arrastrándola en modo edición).
      const cantidadMesas = sector.mesas?.length ?? 0
      const columnas = Math.max(1, Math.floor((sector.ancho - 2 * MARGEN) / CELDA) + 1)
      const filas = Math.max(1, Math.floor((sector.alto - 2 * MARGEN) / CELDA) + 1)
      const fila = Math.min(Math.floor(cantidadMesas / columnas), filas - 1)
      const columna = cantidadMesas % columnas
      const posX = Math.min(Math.round(MARGEN + columna * CELDA), sector.ancho - MARGEN)
      const posY = Math.min(Math.round(MARGEN + fila * CELDA), sector.alto - MARGEN)

      // MesaCreate (backend) no acepta pos_x/pos_y al crear, así que la mesa nace en (0,0)
      // y se reposiciona con un segundo llamado inmediatamente después.
      const { data: mesaPosicionada } = await mesasApi.cambiarPosicion(mesaCreada.id, posX, posY)

      onMesaCreada(mesaPosicionada)
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>
      setError(axiosErr.response?.data?.detail ?? "No se pudo crear la mesa")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: 24,
          width: 360,
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", margin: "0 0 16px" }}>
          Nueva mesa
        </h2>

        {error && (
          <p
            style={{
              fontSize: 13,
              color: "#c62828",
              backgroundColor: "#ffebee",
              border: "1px solid #ef9a9a",
              borderRadius: 6,
              padding: "8px 12px",
              margin: "0 0 12px",
            }}
          >
            {error}
          </p>
        )}

        {!haySectores ? (
          <p style={{ fontSize: 13, color: "#666", margin: "0 0 20px" }}>
            No hay sectores creados todavía. Creá un sector primero.
          </p>
        ) : (
          <>
            <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 12 }}>
              Número de mesa
              <input
                type="number"
                min={1}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
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
              Sector
              <select
                value={sectorId}
                onChange={(e) => setSectorId(e.target.value === "" ? "" : Number(e.target.value))}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginTop: 4,
                  padding: 8,
                  fontSize: 14,
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  backgroundColor: "#fff",
                }}
              >
                {sectores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            disabled={guardando}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #ccc",
              fontSize: 13,
              cursor: guardando ? "default" : "pointer",
              backgroundColor: "#fff",
              color: "#555",
              fontWeight: 500,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={guardando || !haySectores}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 13,
              cursor: guardando || !haySectores ? "default" : "pointer",
              backgroundColor: "#1976d2",
              color: "#fff",
              fontWeight: 500,
              opacity: guardando || !haySectores ? 0.6 : 1,
            }}
          >
            {guardando ? "Creando..." : "Crear mesa"}
          </button>
        </div>
      </div>
    </div>
  )
}
