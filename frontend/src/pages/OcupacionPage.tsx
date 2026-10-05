// Panel de métricas de ocupación (T26-158, RF-22): consume GET /metricas/ocupacion y
// muestra el % general del salón más el conteo de mesas por estado.
//
// Los colores salen de COLOR_POR_ESTADO/BORDE_POR_ESTADO (constants.ts), exactamente los
// mismos que pinta el canvas del salón. Si el panel definiera su propia paleta, el mismo
// estado terminaría con dos colores distintos según la pantalla y el usuario tendría que
// reaprender la leyenda al cambiar de vista.
//
// Lo ve cualquier rol: la ruta va solo detrás de PrivateRoute (ver App.tsx), igual que el
// endpoint, que exige sesión pero no rol admin.

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import Layout from "../components/Layout"
import PestanasMetricas from "../components/PestanasMetricas"
import Boton from "../components/ui/Boton"
import { PieChart, RefreshCw, LayoutGrid, MoonStar } from "lucide-react"
import { metricasApi, extraerDetalle } from "../services/api"
import type { ConteoPorEstado, OcupacionResponse } from "../types"
import { COLOR_POR_ESTADO, BORDE_POR_ESTADO } from "../constants"
import { sinSegundos } from "../horario"

// Mismo orden que la leyenda de SalonCanvas: el panel se recorre igual que el salón.
// Se declara a mano (y no como Object.keys(COLOR_POR_ESTADO)) para que TypeScript valide
// que cada clave existe en ConteoPorEstado; un estado nuevo en el backend rompe acá, que
// es donde conviene enterarse.
const ESTADOS: (keyof ConteoPorEstado)[] = ["libre", "ocupada", "pendiente_limpieza", "reservada"]

const ETIQUETA_POR_ESTADO: Record<keyof ConteoPorEstado, string> = {
  libre: "Libres",
  ocupada: "Ocupadas",
  pendiente_limpieza: "Pendientes de limpieza",
  reservada: "Reservadas",
}

export default function OcupacionPage() {
  const [ocupacion, setOcupacion] = useState<OcupacionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await metricasApi.ocupacion()
      setOcupacion(data)
    } catch (err) {
      // Se descarta la foto anterior: dejarla en pantalla junto al error haría pasar por
      // actual un número que ya no se pudo confirmar.
      setOcupacion(null)
      setError(await extraerDetalle(err, "Error al cargar las métricas de ocupación"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const conteo = ocupacion?.conteo_por_estado
  const salonSinMesas = ocupacion !== null && ocupacion.total_mesas === 0
  // El % NO se recorta por horario, a diferencia de la rotación: esto es una foto del
  // estado actual de las mesas, no un agregado sobre un rango, así que no hay nada que
  // filtrar. Lo que sí corresponde es avisar que la foto se sacó con el local cerrado,
  // porque un 0% a las 4 de la mañana no significa que el salón esté vacío de gente.
  // Lo resuelve el backend y llega hecho (T26-200/F-2). Antes esta pantalla pedía
  // /configuracion aparte y recalculaba la franja con el reloj del navegador, así que el
  // mismo instante podía dar "abierto" acá y "cerrado" del otro lado —el backend evalúa
  // contra TZ_LOCAL—, y con RF-27 esa discrepancia se volvió visible: el dashboard podía
  // marcar una mesa como dudosa por estar el local cerrado mientras este panel decía que
  // estaba abierto.
  const fueraDeHorario = ocupacion != null && !ocupacion.local_abierto

  return (
    <Layout
      acciones={
        /* Las métricas son una foto del momento, no un stream: sin este botón la única
           forma de refrescarlas sería recargar la página entera. */
        <Boton onClick={cargar} icono={RefreshCw} cargando={loading} textoCargando="Actualizando...">
          Actualizar
        </Boton>
      }
    >
      <main className="app-main">
        <PestanasMetricas />

        {fueraDeHorario && ocupacion?.hora_apertura && ocupacion?.hora_cierre && (
          <p
            data-testid="ocupacion-fuera-de-horario"
            className="flex items-center gap-[8px] text-[13px] text-aviso bg-aviso-fondo border border-aviso-borde rounded-[6px] py-[10px] px-[16px] mt-[0px]"
          >
            <MoonStar size={15} className="shrink-0" />
            {`El local está cerrado ahora (servicio de ${sinSegundos(ocupacion.hora_apertura)} a ${sinSegundos(ocupacion.hora_cierre)}). Estos números son del momento actual, no del último servicio.`}
          </p>
        )}

        {loading && <p className="text-[14px] text-gris-400">Cargando métricas...</p>}

        {error && (
          <p
            className="text-[14px] text-error bg-error-fondo border border-error-borde rounded-[6px] py-[10px] px-[16px]"
          >
            {error}
          </p>
        )}

        {/* Salón sin mesas activas: el backend devuelve 0%, pero mostrarlo como un "0% de
            ocupación" haría leer un salón vacío de gente cuando en realidad está vacío de
            mesas. Son dos cosas distintas y solo una es un dato. */}
        {!loading && !error && salonSinMesas && (
          <div
            data-testid="ocupacion-empty"
            className="bg-blanco border border-dashed border-slate-300 rounded-[8px] py-[40px] px-[24px] text-center flex flex-col items-center gap-[10px]"
          >
            <LayoutGrid size={30} className="text-slate-400" />
            <h2 className="text-[16px] font-bold text-slate-900 m-[0px]">
              Todavía no hay mesas activas
            </h2>
            <p className="text-[14px] text-slate-500 m-[0px] max-w-[460px] leading-[1.5]">
              Sin mesas cargadas no hay ocupación que medir. Agregá mesas desde el modo edición
              del panel principal y las métricas aparecen acá.
            </p>
            <Boton variante="primario" onClick={() => navigate("/")} style={{ marginTop: 6 }}>
              Ir al salón
            </Boton>
          </div>
        )}

        {!loading && !error && ocupacion && conteo && !salonSinMesas && (
          <>
            <div
              className="bg-blanco border border-gris-200 rounded-[8px] p-[20px] mb-[24px]"
            >
              <div
                className="flex items-center gap-[8px] text-[12px] font-bold tracking-[0.5px] uppercase text-slate-500"
              >
                <PieChart size={16} />
                Ocupación general
              </div>

              <div
                className="flex items-baseline flex-wrap gap-[12px] mt-[10px]"
              >
                <span
                  data-testid="ocupacion-porcentaje"
                  style={{
                    fontSize: 48,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: BORDE_POR_ESTADO.ocupada,
                  }}
                >
                  {ocupacion.porcentaje_ocupacion}%
                </span>
                <span data-testid="ocupacion-resumen" className="text-[14px] text-slate-600">
                  {conteo.ocupada} de {ocupacion.total_mesas} mesas ocupadas
                </span>
              </div>

              <div
                className="mt-[16px] h-[10px] rounded-[5px] bg-slate-200 overflow-hidden"
              >
                <div
                  data-testid="ocupacion-barra"
                  style={{
                    width: `${ocupacion.porcentaje_ocupacion}%`,
                    height: "100%",
                    backgroundColor: COLOR_POR_ESTADO.ocupada,
                  }}
                />
              </div>

              {/* La aclaración va acá, pegada al número, y no al pie de la página: el % es
                  justamente el dato que se puede leer mal. */}
              <p
                data-testid="ocupacion-nota-porcentaje"
                className="mt-[14px] mx-[0] mb-[0] text-[13px] text-slate-500 leading-[1.5]"
              >
                El porcentaje cuenta <strong>solo las mesas ocupadas</strong>. Las reservadas no
                suman: la mesa sigue físicamente libre hasta que alguien se sienta.
              </p>
            </div>

            <div
              className="flex items-baseline justify-between flex-wrap gap-[8px] mb-[12px]"
            >
              <h2 className="text-[15px] font-bold text-slate-900 m-[0px]">
                Mesas por estado
              </h2>
              <span data-testid="ocupacion-total" className="text-[13px] text-slate-500">
                {`${ocupacion.total_mesas} ${ocupacion.total_mesas === 1 ? "mesa activa" : "mesas activas"} en total`}
              </span>
            </div>

            <div className="flex flex-wrap gap-[16px]">
              {ESTADOS.map((estado) => (
                <div
                  key={estado}
                  // Los data-testid se indexan por la clave del estado, no por la etiqueta
                  // visible: así el spec no se rompe si mañana cambia el texto de la card, y
                  // no hace falta navegar el DOM por posición (ver T26-161, aprendizaje del
                  // Sprint 5 sobre selectores XPath frágiles en ui-helpers.ts).
                  data-testid={`ocupacion-card-${estado}`}
                  style={{
                    flex: "1 1 200px",
                    minWidth: 180,
                    backgroundColor: "var(--color-blanco)",
                    border: "1px solid var(--color-gris-200)",
                    // El color vive en el borde izquierdo y en el número (tono 700 de
                    // BORDE_POR_ESTADO, legible como texto); pintar la card entera del color
                    // del estado la volvería ilegible con los rojos y verdes saturados.
                    borderLeft: `6px solid ${COLOR_POR_ESTADO[estado]}`,
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <div className="flex items-center gap-[8px]">
                    <span
                      data-testid={`ocupacion-swatch-${estado}`}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        flexShrink: 0,
                        backgroundColor: COLOR_POR_ESTADO[estado],
                      }}
                    />
                    <span
                      data-testid={`ocupacion-etiqueta-${estado}`}
                      className="text-[13px] font-semibold text-slate-600"
                    >
                      {ETIQUETA_POR_ESTADO[estado]}
                    </span>
                  </div>

                  <div
                    data-testid={`ocupacion-count-${estado}`}
                    style={{
                      marginTop: 8,
                      fontSize: 32,
                      fontWeight: 700,
                      lineHeight: 1.1,
                      color: BORDE_POR_ESTADO[estado],
                    }}
                  >
                    {conteo[estado]}
                  </div>

                  {/* Segundo recordatorio, justo donde nace la duda: quien mira la card de
                      reservadas y las suma mentalmente al % ya se está equivocando. */}
                  {estado === "reservada" && (
                    <div
                      data-testid="ocupacion-nota-reservada"
                      className="mt-[6px] text-[12px] text-slate-500"
                    >
                      No suman al % de ocupación
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </Layout>
  )
}

// Mismo lenguaje visual que los botones de HistorialPage/CamarasPage, pero con minHeight 44
// para respetar el target táctil mínimo que usa el resto de la app.

