// Modal de edición de una cámara existente.
// El overlay, la caja y los botones los pone <Modal> (T26-200/F-3); acá queda solo el formulario.

import { useState } from "react"
import type { Camara, Sector } from "../types"
import { camarasApi, extraerDetalle } from "../services/api"
import Modal from "./Modal"

interface ModalEditarCamaraProps {
  camara: Camara
  sectores: Sector[]
  onClose: () => void
  onCamaraActualizada: (camara: Camara) => void
}

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

export default function ModalEditarCamara({
  camara,
  sectores,
  onClose,
  onCamaraActualizada,
}: ModalEditarCamaraProps) {
  const [nombre, setNombre] = useState(camara.nombre)
  // Precargado con la URL enmascarada (rtsp://usuario:***@host:puerto/ruta) que devuelve la
  // API: el backend rechaza con 422 si esa misma máscara vuelve en el PATCH (ver
  // schemas/camara.py, _validar_rtsp_url), así que si el usuario no la toca no se manda.
  const [rtspUrl, setRtspUrl] = useState(camara.rtsp_url)
  const [sectorId, setSectorId] = useState<number | "">(camara.sector_id)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rtspUrlModificada = rtspUrl.trim() !== camara.rtsp_url

  async function handleConfirmar() {
    const errorNombre = validarNombre(nombre)
    if (errorNombre) {
      setError(errorNombre)
      return
    }
    if (rtspUrlModificada) {
      const errorUrl = validarRtspUrl(rtspUrl)
      if (errorUrl) {
        setError(errorUrl)
        return
      }
    }
    if (sectorId === "") {
      setError("Seleccioná un sector")
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const { data } = await camarasApi.actualizar(camara.id, {
        nombre: nombre.trim(),
        sector_id: sectorId,
        ...(rtspUrlModificada ? { rtsp_url: rtspUrl.trim() } : {}),
      })
      onCamaraActualizada(data)
    } catch (err) {
      setError(await extraerDetalle(err, "No se pudo actualizar la cámara"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Editar cámara"
      // Más ancha que el default por la URL RTSP, que es larga y en monoespaciada.
      ancho={380}
      error={error}
      ocupado={guardando}
      etiquetaConfirmar={guardando ? "Guardando..." : "Guardar cambios"}
      onConfirmar={handleConfirmar}
      onCancelar={onClose}
    >
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

      <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 4 }}>
        URL RTSP
        <input
          type="text"
          value={rtspUrl}
          onChange={(e) => setRtspUrl(e.target.value)}
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
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 16px" }}>
        {rtspUrlModificada
          ? "Se va a guardar la URL nueva."
          : "La contraseña está oculta (***). Dejá el campo así para no tocar la URL, o escribí la URL completa con la contraseña real para cambiarla."}
      </p>

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
    </Modal>
  )
}
