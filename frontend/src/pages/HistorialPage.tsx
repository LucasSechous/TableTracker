// Vista de consulta del historial de cambios de estado de mesas.
// Filtros opcionales por mesa y rango de fechas; sin filtros muestra el historial completo.

import { useEffect, useState } from "react"
import { Download } from "lucide-react"
import { historialApi, mesasApi, extraerDetalle } from "../services/api"
import type { HistorialFiltros } from "../services/api"
import type { HistorialEstado, Mesa } from "../types"
import RangoFechas, { finDelDia, labelStyle } from "../components/RangoFechas"
import { ETIQUETA_POR_ESTADO } from "../constants"
import { descargarCsv, formatearFechaCsv, generarCsv, nombreArchivoCsv } from "../csv"
import Layout from "../components/Layout"
import Boton from "../components/ui/Boton"

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
      .catch(async (err: unknown) => {
        setHistorial([])
        setTruncado(false)
        setError(await extraerDetalle(err, "Error al cargar el historial"))
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
      setError(await extraerDetalle(err, "No se pudo exportar el historial"))
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
    <Layout>
      <main className="app-main">
        <div
          className="flex flex-wrap items-end gap-[16px] bg-blanco border border-gris-200 rounded-[8px] p-[16px] mb-[20px]"
        >
          <label style={labelStyle}>
            Mesa
            <select
              value={mesaId}
              onChange={(e) => setMesaId(e.target.value)}
              className="py-[6px] px-[8px] rounded-[6px] border border-gris-250 min-w-[160px]"
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
              className="py-[6px] px-[8px] rounded-[6px] border border-gris-250 min-w-[160px]"
            >
              <option value="desc">Más reciente primero</option>
              <option value="asc">Más antiguo primero</option>
            </select>
          </label>

          <Boton variante="primario" onClick={handleBuscar}>
            Buscar
          </Boton>

          <Boton variante="neutro" onClick={handleLimpiar}>
            Limpiar filtros
          </Boton>

          <Boton
            data-testid="historial-exportar-csv"
            icono={Download}
            onClick={handleExportar}
            // Sin filas no hay CSV que bajar: el botón se deshabilita en vez de generar un
            // archivo con solo el encabezado.
            disabled={loading || historial.length === 0}
            cargando={exportando}
            textoCargando="Exportando..."
          >
            Exportar CSV
          </Boton>
        </div>

        {loading && <p className="text-[14px] text-gris-400">Cargando historial...</p>}

        {error && (
          <p
            className="text-[14px] text-error bg-error-fondo border border-error-borde rounded-[6px] py-[10px] px-[16px]"
          >
            {error}
          </p>
        )}

        {truncado && !loading && !error && (
          <p
            data-testid="historial-truncado"
            className="text-[13px] text-aviso bg-aviso-fondo border border-aviso-borde rounded-[6px] py-[10px] px-[16px]"
          >
            {`Hay más registros de los que entran en pantalla: se muestran los primeros ${MAX_FILAS_PANTALLA.toLocaleString("es")}. Exportá a CSV para llevarte el detalle completo, o acotá el rango de fechas.`}
          </p>
        )}

        {!loading && !error && (
          // overflowX en vez de overflow:hidden, como ya hacian Rotacion, Ocupacion diaria y
          // Demanda: con hidden, las columnas que no entran en una pantalla angosta no se
          // recortan con aviso, simplemente no existen para el usuario.
          <div className="bg-blanco border border-gris-200 rounded-[8px] overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="bg-gris-50 text-left">
                  <th className="py-[10px] px-[16px] text-gris-500 font-semibold">Mesa</th>
                  <th className="py-[10px] px-[16px] text-gris-500 font-semibold">Estado</th>
                  <th className="py-[10px] px-[16px] text-gris-500 font-semibold">Origen</th>
                  <th className="py-[10px] px-[16px] text-gris-500 font-semibold">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-[16px] text-gris-400 text-center">
                      No hay registros de historial para estos filtros.
                    </td>
                  </tr>
                )}
                {historial.map((h) => (
                  <tr key={h.id} className="border-t border-t-gris-150">
                    <td className="py-[10px] px-[16px]">{h.mesa_id}</td>
                    <td className="py-[10px] px-[16px]">{ETIQUETA_POR_ESTADO[h.estado] ?? h.estado}</td>
                    <td
                      data-testid={`historial-origen-${h.id}`}
                      style={{ padding: "10px 16px", color: h.origen_cambio === null ? "var(--color-slate-400)" : "var(--color-slate-600)" }}
                    >
                      {etiquetaOrigen(h.origen_cambio)}
                    </td>
                    <td className="py-[10px] px-[16px]">{new Date(h.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </Layout>
  )
}
