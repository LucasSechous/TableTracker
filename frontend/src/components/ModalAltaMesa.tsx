// Modal de alta de una nueva mesa dentro de un sector del salón.
// La posición inicial se calcula en coordenadas locales al sector (ver nota sobre pos_x/pos_y más abajo).
// El overlay, la caja y los botones los pone <Modal> (T26-200/F-3); acá queda solo el formulario.

import { useState } from "react"
import type { Mesa, Sector } from "../types"
import { mesasApi, extraerDetalle } from "../services/api"
import { DIAMETRO_MESA } from "../constants"
import Modal from "./Modal"

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
      setError(await extraerDetalle(err, "No se pudo crear la mesa"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Nueva mesa"
      error={error}
      ocupado={guardando}
      // Sin sectores no hay nada que crear, pero salir sí es una acción válida: por eso
      // bloquea solo el botón primario y no también Cancelar.
      confirmarDeshabilitado={!haySectores}
      etiquetaConfirmar={guardando ? "Creando..." : "Crear mesa"}
      onConfirmar={handleConfirmar}
      onCancelar={onClose}
    >
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
    </Modal>
  )
}
