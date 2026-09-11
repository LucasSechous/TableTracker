// Horarios de mayor demanda (T26-186, RF-24).
//
// Muestra la ocupación media del salón por franja horaria dentro del horario de servicio,
// para identificar a qué hora se llena. Estructura calcada de RotacionPage (header, rango de
// fechas, filtro de sector, exportación CSV) porque es la misma forma de pantalla: un
// agregado histórico sobre un período elegible.
//
// El gráfico son barras con divs, sin librería. Una dependencia de charting para una sola
// vista se paga en bundle y en mantenimiento, y lo que hay que dibujar —una barra horizontal
// por franja -- no justifica ninguna de las dos cosas.
//
// Decisión de lectura, y es la que más importa de esta pantalla: NUNCA se muestra el
// porcentaje solo. Cada franja va acompañada de los minutos medidos, y arriba se dice sobre
// cuántos días se calculó. El riesgo que el propio ticket señala es sobre-interpretar un
// dataset corto, y un gráfico de barras desnudo es exactamente la forma de invitarlo: una
// barra al 100% construida con veinte minutos de medición se ve igual que una construida con
// una semana.

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BarChart3, Download, RefreshCw } from "lucide-react"
import { metricasApi, sectoresApi, extraerDetalleApi } from "../services/api"
import type { DemandaResponse, Sector } from "../types"
import RangoFechas, { labelStyle } from "../components/RangoFechas"
import { descargarCsv, generarCsv, nombreArchivoCsv } from "../csv"

// Por debajo de esto el reporte describe un puñado de días sueltos, no un patrón semanal.
// No bloquea nada: solo dispara el aviso, porque la decisión de si el dato alcanza es del
// que lo lee, no de esta pantalla.
const DIAS_MINIMOS_PARA_PATRON = 3

const estiloBoton: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid #1976d2",
  fontSize: 13,
  cursor: "pointer",
  backgroundColor: "#fff",
  color: "#1976d2",
  fontWeight: 500,
  display: "flex",
  alignItems: "center",
  gap: 6,
}

const estiloTarjeta: React.CSSProperties = {
  backgroundColor: "#fff",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: 16,
}

const estiloError: React.CSSProperties = {
  fontSize: 13,
  color: "#c62828",
  backgroundColor: "#ffebee",
  border: "1px solid #ef9a9a",
  borderRadius: 6,
  padding: "8px 12px",
}

const estiloAviso: React.CSSProperties = {
  fontSize: 13,
  color: "#b45309",
  backgroundColor: "#fffbeb",
  border: "1px solid #fcd34d",
  borderRadius: 6,
  padding: "8px 12px",
}

/** "2026-09-11" a partir de un Date, en hora local del navegador. */
function aFechaInput(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(
    fecha.getDate()
  ).padStart(2, "0")}`
}

const hh = (hora: number) => `${String(hora).padStart(2, "0")}:00`

export default function DemandaPage() {
  const navigate = useNavigate()

  const hoy = new Date()
  const haceUnaSemana = new Date(hoy)
  haceUnaSemana.setDate(hoy.getDate() - 6)

  const [desde, setDesde] = useState(aFechaInput(haceUnaSemana))
  const [hasta, setHasta] = useState(aFechaInput(hoy))
  const [sectorId, setSectorId] = useState<string>("")
  const [sectores, setSectores] = useState<Sector[]>([])
  const [datos, setDatos] = useState<DemandaResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    sectoresApi.listar().then((res) => setSectores(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    buscar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function buscar() {
    setCargando(true)
    try {
      const { data } = await metricasApi.demanda({
        fecha_inicio: desde || undefined,
        fecha_fin: hasta || undefined,
        sector_id: sectorId ? Number(sectorId) : undefined,
      })
      setDatos(data)
      setError(null)
    } catch (err) {
      setError(await extraerDetalleApi(err, "No se pudo cargar el reporte de demanda"))
    } finally {
      setCargando(false)
    }
  }

  function exportar() {
    if (!datos) return
    const contenido = generarCsv(
      ["Franja", "% Ocupación", "Minutos ocupada", "Minutos medidos"],
      datos.franjas.map((f) => [hh(f.hora), f.porcentaje_ocupacion, f.minutos_ocupada, f.minutos_medidos])
    )
    descargarCsv(nombreArchivoCsv("demanda", datos.fecha_inicio, datos.fecha_fin), contenido)
  }

  // La barra se escala contra el máximo observado y no contra 100: con ocupaciones bajas
  // —lo habitual en un salón real— todas las barras contra 100 quedarían pegadas a cero y el
  // gráfico no mostraría ninguna diferencia entre franjas, que es justo lo que se viene a ver.
  // El eje se rotula con ese máximo para que no se lea como si fuera porcentaje absoluto.
  const maximo = datos ? Math.max(...datos.franjas.map((f) => f.porcentaje_ocupacion), 0) : 0
  const pico = datos?.franjas.reduce(
    (mejor, f) => (mejor === null || f.porcentaje_ocupacion > mejor.porcentaje_ocupacion ? f : mejor),
    null as DemandaResponse["franjas"][number] | null
  )

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
          Horarios de mayor demanda
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={buscar} style={estiloBoton} data-testid="demanda-actualizar">
            <RefreshCw size={14} />
            Actualizar
          </button>
          <button onClick={() => navigate("/")} style={estiloBoton}>
            Volver al salón
          </button>
        </div>
      </header>

      <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
        <div style={{ ...estiloTarjeta, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <RangoFechas desde={desde} hasta={hasta} onDesdeChange={setDesde} onHastaChange={setHasta} />
          <label style={labelStyle}>
            Sector
            <select
              data-testid="demanda-filtro-sector"
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", minWidth: 180 }}
            >
              <option value="">Todos los sectores</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={buscar}
            data-testid="demanda-buscar"
            style={{ ...estiloBoton, backgroundColor: "#1976d2", color: "#fff" }}
          >
            Buscar
          </button>
          <button onClick={exportar} disabled={!datos?.franjas.length} style={estiloBoton}>
            <Download size={14} />
            Exportar CSV
          </button>
        </div>

        {cargando && <p style={{ fontSize: 14, color: "#888" }}>Cargando demanda...</p>}
        {error && (
          <p data-testid="demanda-error" style={estiloError}>
            {error}
          </p>
        )}

        {!cargando && !error && datos && (
          <>
            {/* El aviso es parte del entregable, no un adorno: el ticket pide explícitamente
                documentar la limitación en vez de sobre-interpretar un dataset corto. */}
            {datos.franjas.length > 0 && datos.dias < DIAS_MINIMOS_PARA_PATRON && (
              <p data-testid="demanda-aviso-muestra" style={estiloAviso}>
                Este reporte cubre {datos.dias} {datos.dias === 1 ? "día" : "días"}. Con tan pocos días
                el resultado describe lo que pasó esos días puntuales, no un patrón horario del local.
              </p>
            )}

            {datos.franjas.length === 0 ? (
              <p data-testid="demanda-sin-datos" style={{ ...estiloTarjeta, fontSize: 14, color: "#666" }}>
                No hay actividad registrada en el período elegido. El reporte se construye sobre el
                historial de estados dentro del horario de servicio: si el local no operó, o si todavía
                no se acumularon datos, no hay nada que graficar.
              </p>
            ) : (
              <>
                <div style={estiloTarjeta}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      marginBottom: 4,
                    }}
                  >
                    <BarChart3 size={14} />
                    Ocupación media por franja
                  </div>
                  <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#888" }}>
                    {datos.dias} {datos.dias === 1 ? "día operativo" : "días operativos"} entre{" "}
                    {datos.fecha_inicio} y {datos.fecha_fin}
                    {pico && (
                      <>
                        {" · "}
                        <strong data-testid="demanda-pico" style={{ color: "#1a1a1a" }}>
                          pico a las {hh(pico.hora)} ({pico.porcentaje_ocupacion}%)
                        </strong>
                      </>
                    )}
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {datos.franjas.map((f) => (
                      <div
                        key={f.hora}
                        data-testid={`demanda-franja-${f.hora}`}
                        style={{ display: "flex", alignItems: "center", gap: 10 }}
                        title={`${f.minutos_ocupada} de ${f.minutos_medidos} minutos-mesa ocupados`}
                      >
                        <span
                          style={{
                            width: 48,
                            fontSize: 12,
                            color: "#475569",
                            fontVariantNumeric: "tabular-nums",
                            flexShrink: 0,
                          }}
                        >
                          {hh(f.hora)}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: 18,
                            backgroundColor: "#f1f5f9",
                            borderRadius: 4,
                            overflow: "hidden",
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              width: maximo > 0 ? `${(f.porcentaje_ocupacion / maximo) * 100}%` : "0%",
                              height: "100%",
                              backgroundColor: f === pico ? "#b45309" : "#1976d2",
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            width: 56,
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#1a1a1a",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            flexShrink: 0,
                          }}
                        >
                          {f.porcentaje_ocupacion}%
                        </span>
                      </div>
                    ))}
                  </div>

                  <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#94a3b8" }}>
                    Las barras se escalan contra la franja más alta ({maximo}%), no contra el 100%, para
                    que se noten las diferencias entre horas.
                  </p>
                </div>

                {/* La tabla no es redundante con el gráfico: es donde se ve el tamaño de
                    muestra de cada franja, que es lo que permite decidir si una barra alta
                    significa algo o es una hora con dos mediciones. */}
                <div style={{ ...estiloTarjeta, padding: 0, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f8fafc", textAlign: "left" }}>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>Franja</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>% Ocupación</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>Minutos ocupada</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>Minutos medidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.franjas.map((f) => (
                        <tr key={f.hora} data-testid={`demanda-fila-${f.hora}`} style={{ borderTop: "1px solid #eee" }}>
                          <td style={{ padding: "10px 16px" }}>{hh(f.hora)}</td>
                          <td style={{ padding: "10px 16px", fontWeight: 700 }}>{f.porcentaje_ocupacion}%</td>
                          <td style={{ padding: "10px 16px", color: "#475569" }}>{Math.round(f.minutos_ocupada)}</td>
                          <td style={{ padding: "10px 16px", color: "#475569" }}>{Math.round(f.minutos_medidos)}</td>
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
