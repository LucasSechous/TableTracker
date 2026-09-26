// Modal de alta de una nueva cámara IP.
// El select de sector sigue el mismo patrón que ModalAltaMesa.tsx (la cámara también cuelga
// de un sector). El overlay, la caja y los botones los pone <Modal> (T26-200/F-3).

import { useState } from "react"
import type { Camara, Sector } from "../types"
import { camarasApi, extraerDetalle } from "../services/api"
import Modal from "./Modal"

interface ModalAltaCamaraProps {
  sectores: Sector[]
  onClose: () => void
  onCamaraCreada: (camara: Camara) => void
}

// Validación liviana solo para feedback inmediato: la fuente de verdad sigue siendo el
// backend (CamaraCreate en schemas/camara.py), que además verifica host/ruta con rtsp.parsear_url.
function validarNombre(valor: string): string | null {
  const limpio = valor.trim()
  if (!limpio) return "El nombre de la cámara es obligatorio"
  if (limpio.length > 100) return "El nombre no puede superar los 100 caracteres"
  return null
}

function validarRtspUrl(valor: string): string | null {
  const limpia = valor.trim()
  if (!limpia) return "La URL RTSP es obligatoria"
  if (!/^rtsps?:\/\/.+/i.test(limpia)) {
    return "La URL RTSP no es válida: tiene que empezar con rtsp:// o rtsps://"
  }
  return null
}

export default function ModalAltaCamara({ sectores, onClose, onCamaraCreada }: ModalAltaCamaraProps) {
  const [nombre, setNombre] = useState("")
  const [rtspUrl, setRtspUrl] = useState("")
  const [sectorId, setSectorId] = useState<number | "">(sectores[0]?.id ?? "")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const haySectores = sectores.length > 0

  async function handleConfirmar() {
    const errorNombre = validarNombre(nombre)
    if (errorNombre) {
      setError(errorNombre)
      return
    }
    const errorUrl = validarRtspUrl(rtspUrl)
    if (errorUrl) {
      setError(errorUrl)
      return
    }
    if (sectorId === "") {
      setError("Seleccioná un sector")
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const { data } = await camarasApi.crear({
        nombre: nombre.trim(),
        rtsp_url: rtspUrl.trim(),
        sector_id: sectorId,
      })
      onCamaraCreada(data)
    } catch (err) {
      setError(await extraerDetalle(err, "No se pudo crear la cámara"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Nueva cámara"
      // Más ancha que el default por la URL RTSP, que es larga y en monoespaciada.
      ancho={380}
      error={error}
      ocupado={guardando}
      confirmarDeshabilitado={!haySectores}
      etiquetaConfirmar={guardando ? "Creando..." : "Crear cámara"}
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
            Nombre
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
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

          <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 12 }}>
            URL RTSP
            <input
              type="text"
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
              placeholder="rtsp://usuario:contraseña@host:puerto/ruta"
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                marginTop: 4,
                padding: 8,
                fontSize: 14,
                border: "1px solid #ccc",
                borderRadius: 6,
                fontFamily: "monospace",
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
