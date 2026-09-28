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
import Layout from "../components/Layout"
import PestanasMetricas from "../components/PestanasMetricas"
import Boton from "../components/ui/Boton"
import { BarChart3, Download, RefreshCw } from "lucide-react"
import { metricasApi, sectoresApi, extraerDetalle } from "../services/api"
import type { DemandaResponse, Sector } from "../types"
import RangoFechas, { labelStyle } from "../components/RangoFechas"
import { descargarCsv, generarCsv, nombreArchivoCsv } from "../csv"

// Por debajo de esto el reporte describe un puñado de días sueltos, no un patrón semanal.
// No bloquea nada: solo dispara el aviso, porque la decisión de si el dato alcanza es del
// que lo lee, no de esta pantalla.
const DIAS_MINIMOS_PARA_PATRON = 3


const estiloTarjeta: React.CSSProperties = {
  backgroundColor: "var(--color-blanco)",
  border: "1px solid var(--color-gris-200)",
  borderRadius: 8,
  padding: 16,
}

const estiloError: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-error)",
  backgroundColor: "var(--color-error-fondo)",
  border: "1px solid var(--color-error-borde)",
  borderRadius: 6,
  padding: "8px 12px",
}

const estiloAviso: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-aviso-fuerte)",
  backgroundColor: "var(--color-aviso-fuerte-fondo)",
  border: "1px solid var(--color-aviso-fuerte-borde)",
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
      setError(await extraerDetalle(err, "No se pudo cargar el reporte de demanda"))
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
    <Layout
      acciones={
        <Boton onClick={buscar} icono={RefreshCw} data-testid="demanda-actualizar">
          Actualizar
        </Boton>
      }
    >
      <main className="app-main flex flex-col gap-[16px] max-w-[1000px]">
        <PestanasMetricas />

        <div style={{ ...estiloTarjeta, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <RangoFechas desde={desde} hasta={hasta} onDesdeChange={setDesde} onHastaChange={setHasta} />
          <label style={labelStyle}>
            Sector
            <select
              data-testid="demanda-filtro-sector"
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="py-[6px] px-[8px] rounded-[6px] border border-gris-250 min-w-[180px]"
            >
              <option value="">Todos los sectores</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <Boton variante="primario" onClick={buscar} data-testid="demanda-buscar">
            Buscar
          </Boton>
          <Boton icono={Download} onClick={exportar} disabled={!datos?.franjas.length}>
            Exportar CSV
          </Boton>
        </div>

        {cargando && <p className="text-[14px] text-gris-400">Cargando demanda...</p>}
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
              <p data-testid="demanda-sin-datos" style={{ ...estiloTarjeta, fontSize: 14, color: "var(--color-gris-500)" }}>
                No hay actividad registrada en el período elegido. El reporte se construye sobre el
                historial de estados dentro del horario de servicio: si el local no operó, o si todavía
                no se acumularon datos, no hay nada que graficar.
              </p>
            ) : (
              <>
                <div style={estiloTarjeta}>
                  <div
                    className="flex items-center gap-[8px] text-[12px] font-bold text-slate-500 uppercase tracking-[0.4px] mb-[4px]"
                  >
                    <BarChart3 size={14} />
                    Ocupación media por franja
                  </div>
                  <p className="mt-[0] mr-[0] mb-[16px] ml-[0] text-[13px] text-gris-400">
                    {datos.dias} {datos.dias === 1 ? "día operativo" : "días operativos"} entre{" "}
                    {datos.fecha_inicio} y {datos.fecha_fin}
                    {pico && (
                      <>
                        {" · "}
                        <strong data-testid="demanda-pico" className="text-gris-900">
                          pico a las {hh(pico.hora)} ({pico.porcentaje_ocupacion}%)
                        </strong>
                      </>
                    )}
                  </p>

                  <div className="flex flex-col gap-[6px]">
                    {datos.franjas.map((f) => (
                      <div
                        key={f.hora}
                        data-testid={`demanda-franja-${f.hora}`}
                        className="flex items-center gap-[10px]"
                        title={`${f.minutos_ocupada} de ${f.minutos_medidos} minutos-mesa ocupados`}
                      >
                        <span
                          style={{
                            width: 48,
                            fontSize: 12,
                            color: "var(--color-slate-600)",
                            fontVariantNumeric: "tabular-nums",
                            flexShrink: 0,
                          }}
                        >
                          {hh(f.hora)}
                        </span>
                        <div
                          className="flex-[1] h-[18px] bg-slate-100 rounded-[4px] overflow-hidden min-w-[0px]"
                        >
                          <div
                            style={{
                              width: maximo > 0 ? `${(f.porcentaje_ocupacion / maximo) * 100}%` : "0%",
                              height: "100%",
                              backgroundColor: f === pico ? "var(--color-aviso-fuerte)" : "var(--color-marca)",
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            width: 56,
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--color-gris-900)",
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

                  <p className="mt-[12px] mr-[0] mb-[0] ml-[0] text-[12px] text-slate-400">
                    Las barras se escalan contra la franja más alta ({maximo}%), no contra el 100%, para
                    que se noten las diferencias entre horas.
                  </p>
                </div>

                {/* La tabla no es redundante con el gráfico: es donde se ve el tamaño de
                    muestra de cada franja, que es lo que permite decidir si una barra alta
                    significa algo o es una hora con dos mediciones. */}
                <div style={{ ...estiloTarjeta, padding: 0, overflowX: "auto" }}>
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-slate-50 text-left">
                        <th className="py-[12px] px-[16px] font-semibold">Franja</th>
                        <th className="py-[12px] px-[16px] font-semibold">% Ocupación</th>
                        <th className="py-[12px] px-[16px] font-semibold">Minutos ocupada</th>
                        <th className="py-[12px] px-[16px] font-semibold">Minutos medidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.franjas.map((f) => (
                        <tr key={f.hora} data-testid={`demanda-fila-${f.hora}`} className="border-t border-t-gris-150">
                          <td className="py-[10px] px-[16px]">{hh(f.hora)}</td>
                          <td className="py-[10px] px-[16px] font-bold">{f.porcentaje_ocupacion}%</td>
                          <td className="py-[10px] px-[16px] text-slate-600">{Math.round(f.minutos_ocupada)}</td>
                          <td className="py-[10px] px-[16px] text-slate-600">{Math.round(f.minutos_medidos)}</td>
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
    </Layout>
  )
}
