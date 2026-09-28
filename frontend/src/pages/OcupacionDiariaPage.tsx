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
import Layout from "../components/Layout"
import PestanasMetricas from "../components/PestanasMetricas"
import Boton from "../components/ui/Boton"
import { Calendar, Clock, Download, PieChart, RefreshCw } from "lucide-react"
import { metricasApi, sectoresApi, extraerDetalle } from "../services/api"
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
      setError(await extraerDetalle(err, "Error al cargar el reporte de ocupación diaria"))
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
    <Layout
      acciones={
        <Boton onClick={() => buscar(filtros)} icono={RefreshCw} cargando={loading} textoCargando="Actualizando...">
          Actualizar
        </Boton>
      }
    >
      <main className="app-main">
        <PestanasMetricas />

        <div
          className="flex flex-wrap items-end gap-[16px] bg-blanco border border-gris-200 rounded-[8px] p-[16px] mb-[20px]"
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
              className="py-[6px] px-[8px] rounded-[6px] border border-gris-250 min-w-[160px]"
            >
              <option value="">Todos los sectores</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>

          <Boton variante="primario" data-testid="ocupacion-diaria-buscar" onClick={() => buscar(filtros)}>
            Buscar
          </Boton>

          <Boton variante="neutro" data-testid="ocupacion-diaria-limpiar" onClick={handleLimpiar}>
            Hoy
          </Boton>

          <Boton
            data-testid="ocupacion-diaria-exportar-csv"
            icono={Download}
            onClick={handleExportar}
            disabled={loading || filasOrdenadas.length === 0}
          >
            Exportar CSV
          </Boton>
        </div>

        {loading && <p className="text-[14px] text-gris-400">Cargando reporte...</p>}

        {error && (
          <p
            data-testid="ocupacion-diaria-error"
            className="text-[14px] text-error bg-error-fondo border border-error-borde rounded-[6px] py-[10px] px-[16px]"
          >
            {error}
          </p>
        )}

        {!loading && !error && reporte && (
          <>
            <div
              data-testid="ocupacion-diaria-horario"
              className="flex items-center gap-[8px] mb-[16px] text-[12px] text-slate-400"
            >
              <Clock size={13} />
              {`Día operativo: de ${new Date(reporte.inicio).toLocaleString()} a ${new Date(reporte.fin).toLocaleString()}.`}
            </div>

            {sinMesas ? (
              <div
                data-testid="ocupacion-diaria-vacio"
                className="bg-blanco border border-dashed border-slate-300 rounded-[8px] py-[40px] px-[24px] text-center text-slate-500"
              >
                <Calendar size={30} className="text-slate-400 mb-[10px]" />
                <p className="m-[0px] text-[14px]">
                  No hay datos de ocupación para esta fecha.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="bg-blanco border border-gris-200 rounded-[8px] p-[20px] mb-[24px]"
                >
                  <div
                    className="flex items-center gap-[8px] text-[12px] font-bold tracking-[0.5px] uppercase text-slate-500"
                  >
                    <PieChart size={16} />
                    Ocupación del día
                  </div>

                  <div className="flex items-baseline flex-wrap gap-[12px] mt-[10px]">
                    <span
                      data-testid="ocupacion-diaria-porcentaje"
                      style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, color: BORDE_POR_ESTADO.ocupada }}
                    >
                      {reporte.porcentaje_ocupacion}%
                    </span>
                    <span className="text-[14px] text-slate-600">
                      {`${reporte.total_mesas} ${reporte.total_mesas === 1 ? "mesa" : "mesas"} con datos ese día`}
                    </span>
                  </div>

                  <div className="mt-[16px] h-[10px] rounded-[5px] bg-slate-200 overflow-hidden">
                    <div
                      style={{
                        width: `${reporte.porcentaje_ocupacion}%`,
                        height: "100%",
                        backgroundColor: COLOR_POR_ESTADO.ocupada,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-[16px] mt-[20px]">
                    {ESTADOS.map((estado) => (
                      <div
                        key={estado}
                        data-testid={`ocupacion-diaria-card-${estado}`}
                        className="flex-[1_1_160px] min-w-[150px] border border-gris-200 border-l-6 border-l-[${COLOR_POR_ESTADO[estado]}] rounded-[8px] p-[12px]"
                      >
                        <div className="text-[12px] text-slate-500">{ETIQUETA_POR_ESTADO[estado]}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: BORDE_POR_ESTADO[estado] }}>
                          {formatearMinutos(reporte.minutos_por_estado[estado])}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-blanco border border-gris-200 rounded-[8px] overflow-x-auto">
                  <table className="w-full border-collapse text-[14px]">
                    <thead>
                      <tr className="bg-gris-50 text-left">
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
                        <tr key={fila.mesa_id} data-testid={`ocupacion-diaria-fila-${fila.mesa_id}`} className="border-t border-t-gris-150">
                          <td className="py-[10px] px-[16px]">Mesa {fila.numero}</td>
                          <td className="py-[10px] px-[16px] text-slate-600">{nombreSector(fila.sector_id)}</td>
                          <td data-testid={`ocupacion-diaria-porcentaje-${fila.mesa_id}`} className="py-[10px] px-[16px] font-bold">
                            {fila.porcentaje_ocupacion}%
                          </td>
                          <td className="py-[10px] px-[16px] text-slate-600">{formatearMinutos(fila.minutos_por_estado.libre)}</td>
                          <td className="py-[10px] px-[16px] text-slate-600">{formatearMinutos(fila.minutos_por_estado.ocupada)}</td>
                          <td className="py-[10px] px-[16px] text-slate-600">
                            {formatearMinutos(fila.minutos_por_estado.pendiente_limpieza)}
                          </td>
                          <td className="py-[10px] px-[16px] text-slate-600">{formatearMinutos(fila.minutos_por_estado.reservada)}</td>
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

const celdaEncabezado: React.CSSProperties = {
  padding: "12px 16px",
  color: "var(--color-gris-500)",
  fontWeight: 600,
}



