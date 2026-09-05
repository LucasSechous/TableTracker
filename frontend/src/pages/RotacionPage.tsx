// Vista de rotación de mesas (T26-159, RF-23): consume GET /metricas/rotacion y muestra,
// para el rango elegido, cuántas veces rotó cada mesa.
//
// El ticket priorizó una tabla ordenable sobre un gráfico: el valor de la pantalla es que
// el dato se lea claro, no la visualización. Igual se dibuja una barra proporcional dentro
// de la celda de rotaciones, que es gratis y hace comparable el ranking de un vistazo.
//
// Filtros por rango de fechas (RangoFechas, el mismo componente que usa historial) y por
// sector. Lo ve cualquier rol: la ruta va solo detrás de PrivateRoute, igual que el
// endpoint, que exige sesión pero no rol admin.

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowDownUp, Clock, Download, RefreshCw, Repeat } from "lucide-react"
import { metricasApi, sectoresApi, configuracionApi, extraerDetalleApi } from "../services/api"
import type { RotacionMesa, Sector, Configuracion } from "../types"
import RangoFechas, { finDelDia, labelStyle } from "../components/RangoFechas"
import { descargarCsv, generarCsv, nombreArchivoCsv } from "../csv"

type Columna = "numero" | "sector" | "rotaciones"
type Direccion = "asc" | "desc"

interface Filtros {
  desde: string
  hasta: string
  sectorId: string
}

const FILTROS_VACIOS: Filtros = { desde: "", hasta: "", sectorId: "" }

export default function RotacionPage() {
  const [filas, setFilas] = useState<RotacionMesa[]>([])
  const [sectores, setSectores] = useState<Sector[]>([])
  const [config, setConfig] = useState<Configuracion | null>(null)
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [columna, setColumna] = useState<Columna>("rotaciones")
  const [direccion, setDireccion] = useState<Direccion>("desc")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Los filtros con los que se trajo lo que está en pantalla. No son los mismos que `filtros`
  // si el usuario cambió el rango y todavía no le dio a Buscar, y el CSV tiene que
  // corresponderse con la tabla que está viendo, no con lo que quedó tipeado.
  const [aplicados, setAplicados] = useState<Filtros>(FILTROS_VACIOS)
  const navigate = useNavigate()

  useEffect(() => {
    sectoresApi.listar().then((res) => setSectores(res.data)).catch(() => {})
    // Solo para la leyenda: si falla, la tabla igual sirve y no vale la pena un error.
    configuracionApi.obtener().then((res) => setConfig(res.data)).catch(() => {})
  }, [])

  const buscar = useCallback(async (f: Filtros) => {
    setLoading(true)
    setError(null)
    setAplicados(f)
    const params: { fecha_inicio?: string; fecha_fin?: string; sector_id?: number } = {}
    if (f.desde) params.fecha_inicio = f.desde
    if (f.hasta) params.fecha_fin = finDelDia(f.hasta)
    if (f.sectorId) params.sector_id = Number(f.sectorId)

    try {
      const { data } = await metricasApi.rotacion(params)
      setFilas(data)
    } catch (err) {
      // Se vacía la tabla: dejar las filas del rango anterior junto a un error las haría
      // pasar por el resultado del rango que se acaba de pedir.
      setFilas([])
      setError(await extraerDetalleApi(err, "Error al cargar la rotación de mesas"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    buscar(FILTROS_VACIOS)
  }, [buscar])

  function handleLimpiar() {
    setFiltros(FILTROS_VACIOS)
    buscar(FILTROS_VACIOS)
  }

  // Click en la misma columna invierte el orden; en otra, arranca por el criterio que más
  // se suele querer: mayor rotación primero, pero número y sector de menor a mayor.
  function handleOrdenar(nueva: Columna) {
    if (nueva === columna) {
      setDireccion((prev) => (prev === "asc" ? "desc" : "asc"))
      return
    }
    setColumna(nueva)
    setDireccion(nueva === "rotaciones" ? "desc" : "asc")
  }

  const nombrePorSector = new Map(sectores.map((s) => [s.id, s.nombre]))
  function nombreSector(sectorId: number) {
    return nombrePorSector.get(sectorId) ?? `Sector ${sectorId}`
  }

  // El orden se resuelve en el cliente: el endpoint no acepta parámetros de ordenamiento y
  // el volumen es una fila por mesa activa, así que no justifica ida y vuelta al servidor.
  const filasOrdenadas = [...filas].sort((a, b) => {
    const signo = direccion === "asc" ? 1 : -1
    if (columna === "sector") {
      const comparacion = nombreSector(a.sector_id).localeCompare(nombreSector(b.sector_id))
      // Desempate por número de mesa: dentro de un sector, un orden estable se lee mejor
      // que el que devuelva el backend.
      return comparacion !== 0 ? comparacion * signo : a.numero - b.numero
    }
    if (columna === "rotaciones") {
      return a.rotaciones !== b.rotaciones ? (a.rotaciones - b.rotaciones) * signo : a.numero - b.numero
    }
    return (a.numero - b.numero) * signo
  })

  // Se exporta filasOrdenadas, no filas: el orden de la tabla es parte de lo que el usuario
  // está viendo y de lo que pidió el ticket. No hace falta paginar acá —a diferencia del
  // historial— porque el endpoint devuelve una fila por mesa activa y ya está todo en memoria.
  function handleExportar() {
    const contenido = generarCsv(
      ["Mesa", "Sector", "Rotaciones"],
      filasOrdenadas.map((fila) => [fila.numero, nombreSector(fila.sector_id), fila.rotaciones])
    )
    descargarCsv(nombreArchivoCsv("rotacion", aplicados.desde, aplicados.hasta), contenido)
  }

  const totalRotaciones = filas.reduce((acc, f) => acc + f.rotaciones, 0)
  const maxRotaciones = filas.reduce((acc, f) => Math.max(acc, f.rotaciones), 0)
  const sinMesas = !loading && !error && filas.length === 0
  const sinRotaciones = !loading && !error && filas.length > 0 && totalRotaciones === 0

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
          Rotación de mesas
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
          <RangoFechas
            desde={filtros.desde}
            hasta={filtros.hasta}
            onDesdeChange={(desde) => setFiltros((prev) => ({ ...prev, desde }))}
            onHastaChange={(hasta) => setFiltros((prev) => ({ ...prev, hasta }))}
          />

          <label style={labelStyle}>
            Sector
            <select
              data-testid="rotacion-filtro-sector"
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

          <button data-testid="rotacion-buscar" onClick={() => buscar(filtros)} style={estiloBotonPrimario}>
            Buscar
          </button>

          <button data-testid="rotacion-limpiar" onClick={handleLimpiar} style={estiloBotonSecundario}>
            Limpiar filtros
          </button>

          <button
            data-testid="rotacion-exportar-csv"
            onClick={handleExportar}
            disabled={loading || filas.length === 0}
            style={{
              ...estiloBoton,
              opacity: loading || filas.length === 0 ? 0.5 : 1,
              cursor: loading || filas.length === 0 ? "default" : "pointer",
            }}
          >
            <Download size={15} />
            Exportar CSV
          </button>
        </div>

        {loading && <p style={{ fontSize: 14, color: "#888" }}>Cargando rotación...</p>}

        {error && (
          <p
            data-testid="rotacion-error"
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
          <>
            <div
              data-testid="rotacion-resumen"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                fontSize: 13,
                color: "#64748b",
              }}
            >
              <Repeat size={15} />
              {`${totalRotaciones} ${totalRotaciones === 1 ? "rotación" : "rotaciones"} en ${filas.length} ${filas.length === 1 ? "mesa" : "mesas"}`}
            </div>

            {/* Qué franja se está contando (T26-171). Se muestra en los dos casos, con y
                sin horario: que el número cubra las 24 horas también es información, y es
                justamente la que faltaba antes del ticket. */}
            <div
              data-testid="rotacion-horario"
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, color: "#94a3b8" }}
            >
              <Clock size={13} />
              {config?.hora_apertura && config?.hora_cierre
                ? `Acotado al horario de servicio: ${config.hora_apertura.slice(0, 5)} a ${config.hora_cierre.slice(0, 5)}.`
                : "Cuenta las 24 horas del día. Cargá el horario de servicio en Configuración para acotarlo al servicio real."}
            </div>

            <div style={{ backgroundColor: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ backgroundColor: "#fafafa", textAlign: "left" }}>
                    <ColumnaOrdenable etiqueta="Mesa" propia="numero" activa={columna} direccion={direccion} onOrdenar={handleOrdenar} />
                    <ColumnaOrdenable etiqueta="Sector" propia="sector" activa={columna} direccion={direccion} onOrdenar={handleOrdenar} />
                    <ColumnaOrdenable etiqueta="Rotaciones" propia="rotaciones" activa={columna} direccion={direccion} onOrdenar={handleOrdenar} />
                  </tr>
                </thead>
                <tbody>
                  {sinMesas && (
                    <tr>
                      <td data-testid="rotacion-vacio" colSpan={3} style={{ padding: 16, color: "#888", textAlign: "center" }}>
                        No hay mesas activas para estos filtros.
                      </td>
                    </tr>
                  )}
                  {sinRotaciones && (
                    <tr>
                      <td data-testid="rotacion-sin-rotaciones" colSpan={3} style={{ padding: 16, color: "#888", textAlign: "center" }}>
                        Ninguna mesa rotó en el período elegido.
                      </td>
                    </tr>
                  )}
                  {!sinRotaciones &&
                    filasOrdenadas.map((fila) => (
                      <tr key={fila.mesa_id} data-testid={`rotacion-fila-${fila.mesa_id}`} style={{ borderTop: "1px solid #eee" }}>
                        <td data-testid={`rotacion-numero-${fila.mesa_id}`} style={{ padding: "10px 16px" }}>
                          Mesa {fila.numero}
                        </td>
                        <td data-testid={`rotacion-sector-${fila.mesa_id}`} style={{ padding: "10px 16px", color: "#475569" }}>
                          {nombreSector(fila.sector_id)}
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                              data-testid={`rotacion-cantidad-${fila.mesa_id}`}
                              style={{ fontWeight: 700, minWidth: 24, color: "#1e293b" }}
                            >
                              {fila.rotaciones}
                            </span>
                            {/* Barra proporcional a la mesa que más rotó: hace comparable el
                                ranking sin necesidad de leer todos los números. */}
                            <div style={{ flex: 1, maxWidth: 220, height: 8, borderRadius: 4, backgroundColor: "#e2e8f0", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: maxRotaciones > 0 ? `${(fila.rotaciones / maxRotaciones) * 100}%` : "0%",
                                  height: "100%",
                                  backgroundColor: "#1976d2",
                                }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

interface ColumnaProps {
  etiqueta: string
  propia: Columna
  activa: Columna
  direccion: Direccion
  onOrdenar: (columna: Columna) => void
}

function ColumnaOrdenable({ etiqueta, propia, activa, direccion, onOrdenar }: ColumnaProps) {
  const esActiva = propia === activa
  return (
    <th style={{ padding: 0, color: "#666", fontWeight: 600 }}>
      <button
        data-testid={`rotacion-ordenar-${propia}`}
        onClick={() => onOrdenar(propia)}
        // aria-sort va en el <th> por spec, pero el estado también se anuncia acá para que
        // el botón por sí solo diga en qué orden está.
        aria-label={`Ordenar por ${etiqueta}${esActiva ? (direccion === "asc" ? ", ascendente" : ", descendente") : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          minHeight: 44,
          padding: "0 16px",
          border: "none",
          background: "none",
          font: "inherit",
          fontWeight: 600,
          color: esActiva ? "#1976d2" : "#666",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {etiqueta}
        <ArrowDownUp size={13} style={{ opacity: esActiva ? 1 : 0.35 }} />
        {esActiva && <span style={{ fontSize: 11 }}>{direccion === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  )
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
