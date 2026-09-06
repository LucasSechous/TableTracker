// Vista de consulta del historial de cambios de estado de mesas.
// Filtros opcionales por mesa y rango de fechas; sin filtros muestra el historial completo.

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Download } from "lucide-react"
import { historialApi, mesasApi, extraerDetalle } from "../services/api"
import type { HistorialFiltros } from "../services/api"
import type { HistorialEstado, Mesa } from "../types"
import RangoFechas, { finDelDia, labelStyle } from "../components/RangoFechas"
import { ETIQUETA_POR_ESTADO } from "../constants"
import { descargarCsv, formatearFechaCsv, generarCsv, nombreArchivoCsv } from "../csv"

interface FiltrosUi {
  mesaId: string
  fechaInicio: string
  fechaFin: string
  orden: "asc" | "desc"
}

const FILTROS_INICIALES: FiltrosUi = { mesaId: "", fechaInicio: "", fechaFin: "", orden: "desc" }

// Tope de filas que la tabla llega a dibujar. La tabla no está virtualizada: son <tr> sueltos
// en el DOM, así que traer un historial de años enteros no serviría de nada más que para
// clavar la pestaña. Cuando se llega a este tope se avisa y se ofrece el CSV, que no se
// renderiza y sí puede con mucho más.
const MAX_FILAS_PANTALLA = 5000

// La exportación sí recorre el historial en serio: el archivo no pasa por el DOM.
const MAX_FILAS_EXPORTACION = 50000

// Texto del origen del cambio (T26-163). El null tiene su propia etiqueta y no se muestra
// como "Manual": son filas anteriores al ticket, donde el dato no se registraba. Llamarlas
// manuales sería afirmar algo que nadie observó.
const ETIQUETA_POR_ORIGEN: Record<string, string> = {
  automatico: "Automático",
  manual: "Manual",
}

function etiquetaOrigen(origen: string | null): string {
  return origen === null ? "Sin registrar" : ETIQUETA_POR_ORIGEN[origen] ?? origen
}

function aParams(filtros: FiltrosUi): HistorialFiltros {
  const params: HistorialFiltros = { orden: filtros.orden }
  if (filtros.mesaId) params.mesa_id = Number(filtros.mesaId)
  if (filtros.fechaInicio) params.fecha_inicio = filtros.fechaInicio
  if (filtros.fechaFin) params.fecha_fin = finDelDia(filtros.fechaFin)
  return params
}

export default function HistorialPage() {
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [historial, setHistorial] = useState<HistorialEstado[]>([])
  const [truncado, setTruncado] = useState(false)
  const [mesaId, setMesaId] = useState("")
  const [fechaInicio, setFechaInicio] = useState("")
  const [fechaFin, setFechaFin] = useState("")
  const [orden, setOrden] = useState<"asc" | "desc">("desc")
  // Los filtros con los que se trajo lo que está en pantalla, que no son los que el usuario
  // puede estar tipeando ahora. La exportación tiene que usar ESTOS: si alguien cambia el
  // rango y exporta sin darle a Buscar, el CSV debe coincidir con la tabla que está viendo.
  const [aplicados, setAplicados] = useState<FiltrosUi>(FILTROS_INICIALES)
  const [loading, setLoading] = useState(true)
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    mesasApi.listar().then((res) => setMesas(res.data)).catch(() => {})
  }, [])

  function buscar(filtros: FiltrosUi) {
    setLoading(true)
    setError(null)
    setAplicados(filtros)

    historialApi
      .listarTodo(aParams(filtros), MAX_FILAS_PANTALLA)
      .then((res) => {
        setHistorial(res.filas)
        setTruncado(res.truncado)
      })
      .catch((err: unknown) => {
        setHistorial([])
        setTruncado(false)
        setError(extraerDetalle(err, "Error al cargar el historial"))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    buscar(FILTROS_INICIALES)
  }, [])

  // Mesa y sector se resuelven contra el listado de mesas ya cargado para el filtro: el
  // historial solo trae mesa_id. Una mesa dada de baja después del cambio de estado no está
  // en ese listado, y entonces se exporta el id solo en vez de inventar un número.
  const mesaPorId = new Map(mesas.map((m) => [m.id, m]))

  function filasCsv(registros: HistorialEstado[]) {
    return registros.map((h) => {
      const mesa = mesaPorId.get(h.mesa_id)
      return [
        h.mesa_id,
        mesa ? mesa.numero : "",
        mesa ? mesa.sector.nombre : "",
        ETIQUETA_POR_ESTADO[h.estado] ?? h.estado,
        etiquetaOrigen(h.origen_cambio),
        formatearFechaCsv(h.created_at),
      ]
    })
  }

  async function handleExportar() {
    setExportando(true)
    setError(null)
    try {
      // Si la pantalla trajo todo, se exporta exactamente eso: es lo que el usuario está
      // viendo y evita una ida al servidor que podría devolver filas nuevas y no coincidir.
      // Solo cuando quedó truncada hay que volver a pedir, ahora sí hasta el fondo.
      const registros = truncado
        ? (await historialApi.listarTodo(aParams(aplicados), MAX_FILAS_EXPORTACION)).filas
        : historial

      const contenido = generarCsv(
        ["ID mesa", "Mesa", "Sector", "Estado", "Origen", "Fecha"],
        filasCsv(registros)
      )
      descargarCsv(nombreArchivoCsv("historial", aplicados.fechaInicio, aplicados.fechaFin), contenido)
    } catch (err) {
      setError(extraerDetalle(err, "No se pudo exportar el historial"))
    } finally {
      setExportando(false)
    }
  }

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
          <label style={labelStyle}>
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

          <RangoFechas
            desde={fechaInicio}
            hasta={fechaFin}
            onDesdeChange={setFechaInicio}
            onHastaChange={setFechaFin}
          />

          <label style={labelStyle}>
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

          <button
            data-testid="historial-exportar-csv"
            onClick={handleExportar}
            disabled={loading || exportando || historial.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #1976d2",
              backgroundColor: "#fff",
              color: "#1976d2",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              opacity: loading || exportando || historial.length === 0 ? 0.5 : 1,
              cursor: loading || exportando || historial.length === 0 ? "default" : "pointer",
            }}
          >
            <Download size={15} />
            {exportando ? "Exportando..." : "Exportar CSV"}
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

        {truncado && !loading && !error && (
          <p
            data-testid="historial-truncado"
            style={{
              fontSize: 13,
              color: "#8a6d0b",
              backgroundColor: "#fff8e1",
              border: "1px solid #ffe082",
              borderRadius: 6,
              padding: "10px 16px",
            }}
          >
            {`Hay más registros de los que entran en pantalla: se muestran los primeros ${MAX_FILAS_PANTALLA.toLocaleString("es")}. Exportá a CSV para llevarte el detalle completo, o acotá el rango de fechas.`}
          </p>
        )}

        {!loading && !error && (
          <div style={{ backgroundColor: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ backgroundColor: "#fafafa", textAlign: "left" }}>
                  <th style={{ padding: "10px 16px", color: "#666", fontWeight: 600 }}>Mesa</th>
                  <th style={{ padding: "10px 16px", color: "#666", fontWeight: 600 }}>Estado</th>
                  <th style={{ padding: "10px 16px", color: "#666", fontWeight: 600 }}>Origen</th>
                  <th style={{ padding: "10px 16px", color: "#666", fontWeight: 600 }}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: "16px", color: "#888", textAlign: "center" }}>
                      No hay registros de historial para estos filtros.
                    </td>
                  </tr>
                )}
                {historial.map((h) => (
                  <tr key={h.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "10px 16px" }}>{h.mesa_id}</td>
                    <td style={{ padding: "10px 16px" }}>{ETIQUETA_POR_ESTADO[h.estado] ?? h.estado}</td>
                    <td
                      data-testid={`historial-origen-${h.id}`}
                      style={{ padding: "10px 16px", color: h.origen_cambio === null ? "#94a3b8" : "#475569" }}
                    >
                      {etiquetaOrigen(h.origen_cambio)}
                    </td>
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
