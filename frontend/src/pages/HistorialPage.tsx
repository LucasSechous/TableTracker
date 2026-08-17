// Vista de consulta del historial de cambios de estado de mesas.
// Filtros opcionales por mesa y rango de fechas; sin filtros muestra el historial completo.

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { historialApi, mesasApi } from "../services/api"
import type { HistorialEstado, Mesa } from "../types"

const ESTADO_LABEL: Record<string, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pendiente_limpieza: "Pendiente de limpieza",
  reservada: "Reservada",
}

function extraerDetalle(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
}

export default function HistorialPage() {
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [historial, setHistorial] = useState<HistorialEstado[]>([])
  const [mesaId, setMesaId] = useState("")
  const [fechaInicio, setFechaInicio] = useState("")
  const [fechaFin, setFechaFin] = useState("")
  const [orden, setOrden] = useState<"asc" | "desc">("desc")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    mesasApi.listar().then((res) => setMesas(res.data)).catch(() => {})
  }, [])

  function buscar(filtros: { mesaId: string; fechaInicio: string; fechaFin: string; orden: "asc" | "desc" }) {
    setLoading(true)
    setError(null)
    const params: { mesa_id?: number; fecha_inicio?: string; fecha_fin?: string; orden: "asc" | "desc" } = {
      orden: filtros.orden,
    }
    if (filtros.mesaId) params.mesa_id = Number(filtros.mesaId)
    if (filtros.fechaInicio) params.fecha_inicio = filtros.fechaInicio
    if (filtros.fechaFin) params.fecha_fin = `${filtros.fechaFin}T23:59:59`

    historialApi
      .listar(params)
      .then((res) => setHistorial(res.data))
      .catch((err: unknown) => {
        setHistorial([])
        setError(extraerDetalle(err, "Error al cargar el historial"))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    buscar({ mesaId: "", fechaInicio: "", fechaFin: "", orden: "desc" })
  }, [])

  function handleBuscar() {
    buscar({ mesaId, fechaInicio, fechaFin, orden })
  }

  function handleLimpiar() {
    setMesaId("")
    setFechaInicio("")
    setFechaFin("")
    buscar({ mesaId: "", fechaInicio: "", fechaFin: "", orden })
  }

  function handleOrdenChange(nuevoOrden: "asc" | "desc") {
    setOrden(nuevoOrden)
    buscar({ mesaId, fechaInicio, fechaFin, orden: nuevoOrden })
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <header
        style={{
          backgroundColor: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
          Historial de mesas
        </h1>
        <button
          onClick={() => navigate("/")}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #1976d2",
            fontSize: 13,
            cursor: "pointer",
            backgroundColor: "#fff",
            color: "#1976d2",
            fontWeight: 500,
          }}
        >
          Volver al salón
        </button>
      </header>

      <main style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 16,
            backgroundColor: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#444" }}>
            Mesa
            <select
              value={mesaId}
              onChange={(e) => setMesaId(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", minWidth: 160 }}
            >
              <option value="">Todas las mesas</option>
              {mesas.map((m) => (
                <option key={m.id} value={m.id}>
                  Mesa {m.numero} · {m.sector.nombre}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#444" }}>
            Desde
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#444" }}>
            Hasta
            <input
              type="date"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#444" }}>
            Orden
            <select
              value={orden}
              onChange={(e) => handleOrdenChange(e.target.value as "asc" | "desc")}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", minWidth: 160 }}
            >
              <option value="desc">Más reciente primero</option>
              <option value="asc">Más antiguo primero</option>
            </select>
          </label>

          <button
            onClick={handleBuscar}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: "#1976d2",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Buscar
          </button>

          <button
            onClick={handleLimpiar}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #ccc",
              backgroundColor: "#fff",
              color: "#444",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Limpiar filtros
          </button>
        </div>

        {loading && <p style={{ fontSize: 14, color: "#888" }}>Cargando historial...</p>}

        {error && (
          <p
            style={{
              fontSize: 14,
              color: "#c62828",
              backgroundColor: "#ffebee",
              border: "1px solid #ef9a9a",
              borderRadius: 6,
              padding: "10px 16px",
            }}
          >
            {error}
          </p>
        )}

        {!loading && !error && (
          <div style={{ backgroundColor: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ backgroundColor: "#fafafa", textAlign: "left" }}>
                  <th style={{ padding: "10px 16px", color: "#666", fontWeight: 600 }}>Mesa</th>
                  <th style={{ padding: "10px 16px", color: "#666", fontWeight: 600 }}>Estado</th>
                  <th style={{ padding: "10px 16px", color: "#666", fontWeight: 600 }}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: "16px", color: "#888", textAlign: "center" }}>
                      No hay registros de historial para estos filtros.
                    </td>
                  </tr>
                )}
                {historial.map((h) => (
                  <tr key={h.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "10px 16px" }}>{h.mesa_id}</td>
                    <td style={{ padding: "10px 16px" }}>{ESTADO_LABEL[h.estado] ?? h.estado}</td>
                    <td style={{ padding: "10px 16px" }}>{new Date(h.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
