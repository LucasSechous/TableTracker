// Vista de ocupación diaria (T26-185, RF-32): consume GET /metricas/ocupacion-diaria y
// muestra, para una fecha elegida, cuánto tiempo estuvo cada mesa libre/ocupada/pendiente
// de limpieza y el % de ocupación del salón.
//
// A diferencia de OcupacionPage (una foto del instante) y RotacionPage (conteo de
// transiciones en un rango), acá el backend ya reconstruyó minutos por estado a partir de
// historial_estados, acotados al "día operativo" de la fecha elegida —no a medianoche
// civil— para no partir en dos un turno que cruza la medianoche (ver rango_dia_operativo en
// el backend). `inicio`/`fin` vienen resueltos en la respuesta y se muestran tal cual, sin
// recalcularlos acá.
//
// Selector de una sola fecha (no un rango: el input de RangoFechas es desde/hasta y no
// aplica), reusando labelStyle/inputStyle de ese mismo componente para no duplicar el
// estilo. Lo ve cualquier rol, igual que /ocupacion y /rotacion: la ruta va solo detrás de
// PrivateRoute (ver App.tsx).

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Calendar, Clock, Download, PieChart, RefreshCw } from "lucide-react"
import { metricasApi, sectoresApi, extraerDetalleApi } from "../services/api"
import type { OcupacionDiariaResponse, Sector } from "../types"
import { labelStyle, inputStyle } from "../components/RangoFechas"
import { descargarCsv, generarCsv, nombreArchivoCsv } from "../csv"
import { COLOR_POR_ESTADO, BORDE_POR_ESTADO } from "../constants"

const ESTADOS = ["libre", "ocupada", "pendiente_limpieza", "reservada"] as const
type Estado = (typeof ESTADOS)[number]

const ETIQUETA_POR_ESTADO: Record<Estado, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pendiente_limpieza: "Pendiente de limpieza",
  reservada: "Reservada",
}

interface Filtros {
  fecha: string
  sectorId: string
}

function hoyIso(): string {
  const ahora = new Date()
  const dosDigitos = (n: number) => String(n).padStart(2, "0")
  return `${ahora.getFullYear()}-${dosDigitos(ahora.getMonth() + 1)}-${dosDigitos(ahora.getDate())}`
}

// Xh Ym, o solo Ym si no llega a la hora: son minutos reconstruidos, no vale la pena
// mostrar segundos de un cálculo que ya redondea en el backend.
function formatearMinutos(minutos: number): string {
  const totales = Math.round(minutos)
  const horas = Math.floor(totales / 60)
  const resto = totales % 60
  return horas > 0 ? `${horas}h ${resto}m` : `${resto}m`
}

const FILTROS_INICIALES = (): Filtros => ({ fecha: hoyIso(), sectorId: "" })

export default function OcupacionDiariaPage() {
  const [reporte, setReporte] = useState<OcupacionDiariaResponse | null>(null)
  const [sectores, setSectores] = useState<Sector[]>([])
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Los filtros con los que se trajo lo que está en pantalla, para que el CSV exportado
  // corresponda a la tabla que se está viendo y no a lo que quedó tipeado sin buscar.
  const [aplicados, setAplicados] = useState<Filtros>(FILTROS_INICIALES)
  const navigate = useNavigate()

  useEffect(() => {
    sectoresApi.listar().then((res) => setSectores(res.data)).catch(() => {})
  }, [])

  // StrictMode dispara el effect de montaje dos veces en desarrollo, así que dos búsquedas
  // sin filtro salen a la vez al cargar la pantalla. Sin esta guarda, si esa duplicada
  // resuelve después de una búsqueda posterior (ej. el usuario ya aplicó un filtro de
  // sector), su respuesta vieja pisa la nueva y la tabla vuelve a mostrar todo sin filtrar.
  // Solo se aplica la respuesta de la ÚLTIMA búsqueda disparada, sea cual sea el orden en
  // que efectivamente respondan.
  const ultimaPeticion = useRef(0)

  const buscar = useCallback(async (f: Filtros) => {
    const idPeticion = ++ultimaPeticion.current
    setLoading(true)
    setError(null)
    setAplicados(f)
    const params: { fecha?: string; sector_id?: number } = {}
    if (f.fecha) params.fecha = f.fecha
    if (f.sectorId) params.sector_id = Number(f.sectorId)

    try {
      const { data } = await metricasApi.ocupacionDiaria(params)
      if (idPeticion !== ultimaPeticion.current) return
      setReporte(data)
    } catch (err) {
      if (idPeticion !== ultimaPeticion.current) return
      // Se descarta el reporte anterior: dejarlo junto a un error lo haría pasar por el
      // resultado de la fecha que se acaba de pedir.
      setReporte(null)
      setError(await extraerDetalleApi(err, "Error al cargar el reporte de ocupación diaria"))
    } finally {
      if (idPeticion === ultimaPeticion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    buscar(FILTROS_INICIALES())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleLimpiar() {
    const iniciales = FILTROS_INICIALES()
    setFiltros(iniciales)
    buscar(iniciales)
  }

  const nombrePorSector = new Map(sectores.map((s) => [s.id, s.nombre]))
  function nombreSector(sectorId: number) {
    return nombrePorSector.get(sectorId) ?? `Sector ${sectorId}`
  }

  const filasOrdenadas = reporte ? [...reporte.mesas].sort((a, b) => a.numero - b.numero) : []

  function handleExportar() {
    if (!reporte) return
    const contenido = generarCsv(
      ["Mesa", "Sector", "% Ocupación", "Libre (min)", "Ocupada (min)", "Pendiente limpieza (min)", "Reservada (min)"],
      filasOrdenadas.map((fila) => [
        fila.numero,
        nombreSector(fila.sector_id),
        fila.porcentaje_ocupacion,
        Math.round(fila.minutos_por_estado.libre),
        Math.round(fila.minutos_por_estado.ocupada),
        Math.round(fila.minutos_por_estado.pendiente_limpieza),
        Math.round(fila.minutos_por_estado.reservada),
      ])
    )
    descargarCsv(nombreArchivoCsv("ocupacion-diaria", aplicados.fecha, aplicados.fecha), contenido)
  }

  const sinMesas = !loading && !error && reporte !== null && reporte.mesas.length === 0

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
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
          Ocupación diaria
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => buscar(filtros)}
            disabled={loading}
            style={{ ...estiloBoton, opacity: loading ? 0.6 : 1 }}
          >
            <RefreshCw size={15} />
            Actualizar
          </button>
          <button onClick={() => navigate("/")} style={estiloBoton}>
            Volver al salón
          </button>
        </div>
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
            Fecha
            <input
              type="date"
              data-testid="ocupacion-diaria-fecha"
              value={filtros.fecha}
              onChange={(e) => setFiltros((prev) => ({ ...prev, fecha: e.target.value }))}
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            Sector
            <select
              data-testid="ocupacion-diaria-filtro-sector"
              value={filtros.sectorId}
              onChange={(e) => setFiltros((prev) => ({ ...prev, sectorId: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", minWidth: 160 }}
            >
              <option value="">Todos los sectores</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>

          <button data-testid="ocupacion-diaria-buscar" onClick={() => buscar(filtros)} style={estiloBotonPrimario}>
            Buscar
          </button>

          <button data-testid="ocupacion-diaria-limpiar" onClick={handleLimpiar} style={estiloBotonSecundario}>
            Hoy
          </button>

          <button
            data-testid="ocupacion-diaria-exportar-csv"
            onClick={handleExportar}
            disabled={loading || filasOrdenadas.length === 0}
            style={{
              ...estiloBoton,
              opacity: loading || filasOrdenadas.length === 0 ? 0.5 : 1,
              cursor: loading || filasOrdenadas.length === 0 ? "default" : "pointer",
            }}
          >
            <Download size={15} />
            Exportar CSV
          </button>
        </div>

        {loading && <p style={{ fontSize: 14, color: "#888" }}>Cargando reporte...</p>}

        {error && (
          <p
            data-testid="ocupacion-diaria-error"
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

        {!loading && !error && reporte && (
          <>
            <div
              data-testid="ocupacion-diaria-horario"
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 12, color: "#94a3b8" }}
            >
              <Clock size={13} />
              {`Día operativo: de ${new Date(reporte.inicio).toLocaleString()} a ${new Date(reporte.fin).toLocaleString()}.`}
            </div>

            {sinMesas ? (
              <div
                data-testid="ocupacion-diaria-vacio"
                style={{
                  backgroundColor: "#fff",
                  border: "1px dashed #cbd5e1",
                  borderRadius: 8,
                  padding: "40px 24px",
                  textAlign: "center",
                  color: "#64748b",
                }}
              >
                <Calendar size={30} color="#94a3b8" style={{ marginBottom: 10 }} />
                <p style={{ margin: 0, fontSize: 14 }}>
                  No hay datos de ocupación para esta fecha.
                </p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #e0e0e0",
                    borderRadius: 8,
                    padding: 20,
                    marginBottom: 24,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: "#64748b",
                    }}
                  >
                    <PieChart size={16} />
                    Ocupación del día
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
                    <span
                      data-testid="ocupacion-diaria-porcentaje"
                      style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, color: BORDE_POR_ESTADO.ocupada }}
                    >
                      {reporte.porcentaje_ocupacion}%
                    </span>
                    <span style={{ fontSize: 14, color: "#475569" }}>
                      {`${reporte.total_mesas} ${reporte.total_mesas === 1 ? "mesa" : "mesas"} con datos ese día`}
                    </span>
                  </div>

                  <div style={{ marginTop: 16, height: 10, borderRadius: 5, backgroundColor: "#e2e8f0", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${reporte.porcentaje_ocupacion}%`,
                        height: "100%",
                        backgroundColor: COLOR_POR_ESTADO.ocupada,
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 20 }}>
                    {ESTADOS.map((estado) => (
                      <div
                        key={estado}
                        data-testid={`ocupacion-diaria-card-${estado}`}
                        style={{
                          flex: "1 1 160px",
                          minWidth: 150,
                          border: "1px solid #e0e0e0",
                          borderLeft: `6px solid ${COLOR_POR_ESTADO[estado]}`,
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#64748b" }}>{ETIQUETA_POR_ESTADO[estado]}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: BORDE_POR_ESTADO[estado] }}>
                          {formatearMinutos(reporte.minutos_por_estado[estado])}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ backgroundColor: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                      <tr style={{ backgroundColor: "#fafafa", textAlign: "left" }}>
                        <th style={celdaEncabezado}>Mesa</th>
                        <th style={celdaEncabezado}>Sector</th>
                        <th style={celdaEncabezado}>% Ocupación</th>
                        <th style={celdaEncabezado}>Libre</th>
                        <th style={celdaEncabezado}>Ocupada</th>
                        <th style={celdaEncabezado}>Pend. limpieza</th>
                        <th style={celdaEncabezado}>Reservada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasOrdenadas.map((fila) => (
                        <tr key={fila.mesa_id} data-testid={`ocupacion-diaria-fila-${fila.mesa_id}`} style={{ borderTop: "1px solid #eee" }}>
                          <td style={{ padding: "10px 16px" }}>Mesa {fila.numero}</td>
                          <td style={{ padding: "10px 16px", color: "#475569" }}>{nombreSector(fila.sector_id)}</td>
                          <td data-testid={`ocupacion-diaria-porcentaje-${fila.mesa_id}`} style={{ padding: "10px 16px", fontWeight: 700 }}>
                            {fila.porcentaje_ocupacion}%
                          </td>
                          <td style={{ padding: "10px 16px", color: "#475569" }}>{formatearMinutos(fila.minutos_por_estado.libre)}</td>
                          <td style={{ padding: "10px 16px", color: "#475569" }}>{formatearMinutos(fila.minutos_por_estado.ocupada)}</td>
                          <td style={{ padding: "10px 16px", color: "#475569" }}>
                            {formatearMinutos(fila.minutos_por_estado.pendiente_limpieza)}
                          </td>
                          <td style={{ padding: "10px 16px", color: "#475569" }}>{formatearMinutos(fila.minutos_por_estado.reservada)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

const celdaEncabezado: React.CSSProperties = {
  padding: "12px 16px",
  color: "#666",
  fontWeight: 600,
}

const estiloBoton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 6,
  border: "1px solid #1976d2",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  backgroundColor: "#fff",
  color: "#1976d2",
  whiteSpace: "nowrap",
}

const estiloBotonPrimario: React.CSSProperties = {
  ...estiloBoton,
  border: "none",
  backgroundColor: "#1976d2",
  color: "#fff",
  fontWeight: 600,
}

const estiloBotonSecundario: React.CSSProperties = {
  ...estiloBoton,
  border: "1px solid #ccc",
  color: "#444",
}
