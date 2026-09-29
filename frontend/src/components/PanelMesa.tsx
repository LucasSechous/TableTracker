// Panel lateral deslizante con el detalle de una mesa: estado actual, tiempo
// transcurrido en ese estado y la corrección manual (RF-17), colapsada por
// defecto para no competir visualmente con la detección automática.
// Excepción: "Confirmar limpieza" se muestra sin colapsar cuando la mesa está
// pendiente_limpieza, porque es el cierre esperado de ese estado y no una
// corrección.
// No muestra origen automático/manual: ese dato no existe todavía en el
// modelo (ver ticket de backend pendiente para T26-138).

import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import type { Mesa } from "../types"
import { historialApi, mesasApi, extraerDetalle } from "../services/api"
import { COLOR_POR_ESTADO, ETIQUETA_POR_ESTADO, horaDeLaReserva } from "../constants"
import { useAuth } from "../hooks/useAuth"
import { useAvisoError } from "../hooks/useAvisoError"
import { esAdmin, puedeCambiarEstado, puedeConfirmarLimpieza, puedeReservar } from "../permisos"
import CamaraDeLaMesa from "./CamaraDeLaMesa"
import Boton from "./ui/Boton"
import { CalendarClock } from "lucide-react"

interface Props {
  mesa: Mesa | null
  onClose: () => void
  onEstadoChange: (mesaId: number, nuevoEstado: string) => void
  onMesaActualizada: (mesa: Mesa) => void
}

function formatearTranscurrido(desde: Date): string {
  const minutos = Math.floor((Date.now() - desde.getTime()) / 60000)
  const horas = Math.floor(minutos / 60)
  if (horas > 0) return `hace ${horas}h ${minutos % 60}min`
  if (minutos <= 0) return "recién"
  return `hace ${minutos} min`
}

export default function PanelMesa({ mesa, onClose, onEstadoChange, onMesaActualizada }: Props) {
  // Mismo patrón que SectorBloque y MesaVisual (T26-194): el rol se lee del contexto en vez
  // de bajarlo por props desde DashboardPage a través de SalonCanvas, que no lo usa.
  const { rol } = useAuth()
  // Los fallos de una acción salen por el banner del salón y no por alert() (T26-200/F-9):
  // este panel es el flujo de uso continuo donde un diálogo del navegador más interrumpe.
  const avisarError = useAvisoError()

  const [desde, setDesde] = useState<Date | null>(null)
  const [expandido, setExpandido] = useState(false)
  // Hora tecleada para la reserva, en formato HH:MM del <input type="time">. Vacía
  // significa reservar sin hora, que sigue siendo válido.
  const [horaReserva, setHoraReserva] = useState("")
  // Si el formulario de reserva está desplegado. Colapsado por defecto: abrir una mesa
  // para mirarla es más frecuente que abrirla para reservarla.
  const [reservando, setReservando] = useState(false)
  const [accionando, setAccionando] = useState(false)
  const [, forceTick] = useState(0)

  const abierto = mesa !== null

  useEffect(() => {
    setExpandido(false)
    setReservando(false)
    setHoraReserva("")
    setDesde(null)
    if (!mesa) return
    let cancelado = false
    historialApi
      .listar({ mesa_id: mesa.id, orden: "desc" })
      .then(({ data }) => {
        if (cancelado) return
        setDesde(new Date(data[0]?.created_at ?? mesa.created_at))
      })
      .catch(() => {
        if (!cancelado) setDesde(new Date(mesa.created_at))
      })
    return () => {
      cancelado = true
    }
    // Reconsulta el historial si cambia la mesa seleccionada o si su estado se
    // actualiza mientras el panel está abierto (ej. lo cambia vision-module).
  }, [mesa?.id, mesa?.estado, mesa?.created_at])

  useEffect(() => {
    if (!abierto) return
    const id = setInterval(() => forceTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [abierto])

  async function ejecutarAccion(accion: () => Promise<{ data: Mesa }>) {
    setAccionando(true)
    try {
      const { data } = await accion()
      onMesaActualizada(data)
      setExpandido(false)
    } catch (err) {
      avisarError(await extraerDetalle(err, "No se pudo cambiar el estado de la mesa"))
    } finally {
      setAccionando(false)
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.4)",
          zIndex: 200,
          opacity: abierto ? 1 : 0,
          visibility: abierto ? "visible" : "hidden",
          transition: "opacity 0.2s ease",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          maxWidth: 380,
          backgroundColor: "var(--color-blanco)",
          zIndex: 201,
          transform: abierto ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 20px rgba(0,0,0,0.1)",
        }}
      >
        {mesa && (
          <>
            <div
              className="p-[20px] border-b-2 border-b-slate-200 flex items-center justify-between gap-[12px]"
            >
              <div className="text-[18px] font-bold">
                Mesa {mesa.numero} · {mesa.sector.nombre}
              </div>
              <button
                data-testid="panel-mesa-cerrar"
                onClick={onClose}
                aria-label="Cerrar"
                className="w-[44px] h-[44px] shrink-0 border-0 bg-slate-100 rounded-[10px] text-[22px] leading-[1] cursor-pointer flex items-center justify-center text-slate-500"
              >
                ×
              </button>
            </div>

            <div className="flex-[1] overflow-y-auto p-[20px]">
              <div className="mb-[24px]">
                <div style={etiquetaStyle}>Estado actual</div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 14,
                    backgroundColor: `${COLOR_POR_ESTADO[mesa.estado] ?? "var(--color-gris-desconocido)"}20`,
                    color: COLOR_POR_ESTADO[mesa.estado] ?? "#616161",
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      backgroundColor: COLOR_POR_ESTADO[mesa.estado] ?? "var(--color-gris-desconocido)",
                      flexShrink: 0,
                    }}
                  />
                  {ETIQUETA_POR_ESTADO[mesa.estado] ?? mesa.estado}
                </div>
              </div>

              {/* Reservar, pegado al estado y no escondido en la corrección manual: es una
                  acción del día a día de quien atiende el salón, no un arreglo.

                  Colapsado igual, porque abrir una mesa para mirarla es más frecuente que
                  abrirla para reservarla, y un campo de hora siempre desplegado empujaría
                  hacia abajo el estado y el tiempo, que son lo que se viene a ver.

                  PATCH /mesas/{id}/reserva pide encargado o recepción (T26-195). */}
              {mesa.estado !== "reservada" && puedeReservar(rol) && (
                <div className="mb-[24px]">
                  {!reservando ? (
                    <Boton
                      icono={CalendarClock}
                      data-testid="panel-mesa-abrir-reserva"
                      onClick={() => setReservando(true)}
                    >
                      Reservar mesa
                    </Boton>
                  ) : (
                    <div className="flex flex-col gap-[8px]">
                      <label className="text-[12px] text-slate-500 flex flex-col gap-[4px]">
                        {/* Opcional a propósito: una hostess normalmente reserva PARA una
                            hora, y con ella el salón puede mostrar para cuándo es y avisar
                            cuando se pasó; pero reservar sin decir hora seguía siendo
                            válido antes de T26-208 y tiene que seguir siéndolo. */}
                        Hora de la reserva (opcional)
                        <input
                          data-testid="panel-mesa-hora-reserva"
                          type="time"
                          autoFocus
                          value={horaReserva}
                          onChange={(e) => setHoraReserva(e.target.value)}
                          className="min-h-[44px] py-[6px] px-[10px] rounded-[6px] border border-slate-300 bg-blanco text-[14px] font-[inherit]"
                        />
                      </label>
                      <div className="flex gap-[8px] flex-wrap">
                        <Boton
                          variante="primario"
                          data-testid="panel-mesa-reservar"
                          cargando={accionando}
                          textoCargando="Reservando..."
                          onClick={() =>
                            ejecutarAccion(() =>
                              mesasApi.marcarReservada(mesa.id, momentoDeHoy(horaReserva))
                            )
                          }
                        >
                          {horaReserva ? `Reservar para las ${horaReserva}` : "Reservar sin hora"}
                        </Boton>
                        <Boton
                          variante="neutro"
                          data-testid="panel-mesa-cancelar-reserva"
                          disabled={accionando}
                          onClick={() => {
                            setReservando(false)
                            setHoraReserva("")
                          }}
                        >
                          Cancelar
                        </Boton>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Ya reservada: lo útil no es volver a reservar sino saber para cuándo. */}
              {mesa.estado === "reservada" && horaDeLaReserva(mesa.reservada_para) && (
                <div className="mb-[24px]" data-testid="panel-mesa-reservada-para">
                  <div style={etiquetaStyle}>Reservada para</div>
                  <div className="text-[16px] font-semibold text-slate-900">
                    {horaDeLaReserva(mesa.reservada_para)}
                  </div>
                </div>
              )}

              <div className="mb-[24px]">
                <div style={etiquetaStyle}>Tiempo en este estado</div>
                <div className="text-[16px] font-semibold text-slate-900">
                  {desde ? formatearTranscurrido(desde) : "Calculando..."}
                </div>
              </div>

              {/* Después del estado y antes de las acciones: primero qué pasa con la mesa,
                  después con qué se lo está viendo, y al final qué se puede hacer.

                  Solo admin, y no por comodidad: docs/privacidad-vision.md declara la
                  restricción de las cámaras a admin como control de privacidad, referenciado
                  contra el anteproyecto. Para los demás roles el componente no dibuja nada. */}
              <CamaraDeLaMesa mesaId={mesa.id} habilitado={esAdmin(rol)} />

              {/* PATCH /mesas/{id}/limpieza pide encargado o limpieza (T26-195): un mozo
                  veía este botón y se comía el 403 recién al tocarlo. */}
              {mesa.estado === "pendiente_limpieza" && puedeConfirmarLimpieza(rol) && (
                <button
                  disabled={accionando}
                  onClick={() => ejecutarAccion(() => mesasApi.confirmarLimpieza(mesa.id))}
                  style={{
                    width: "100%",
                    minHeight: 44,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#4caf50",
                    color: "var(--color-blanco)",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: accionando ? "default" : "pointer",
                    opacity: accionando ? 0.6 : 1,
                    marginBottom: 24,
                  }}
                >
                  Confirmar limpieza
                </button>
              )}

              {/* Desde T26-208 el desplegable contiene SOLO la corrección manual: reservar
                  salió de acá y subió arriba, con su propio botón. Estaban juntas por
                  parecido —las dos cambian el estado— pero no son lo mismo: reservar es
                  una acción del día a día de la hostess, y corregir es arreglar algo que
                  la detección leyó mal. Esconder la primera detrás de "Corregir estado
                  manualmente" la volvía difícil de encontrar y la hacía parecer un
                  arreglo. */}
              {puedeCambiarEstado(rol) && (
                <div>
                  <button
                    data-testid="panel-mesa-toggle-correccion"
                    onClick={() => setExpandido((v) => !v)}
                    className="min-h-[44px] py-[8px] px-[14px] rounded-[8px] border border-slate-300 bg-blanco text-slate-600 text-[13px] font-semibold cursor-pointer"
                  >
                    {expandido ? "Ocultar corrección manual" : "Corregir estado manualmente"}
                  </button>
                  {/* Anclas estables para los tests: la corrección manual pasó de ser un
                      <select> inline sobre el canvas a este panel colapsable, y los specs
                      que la ejercitan necesitan poder llegar sin depender del texto. */}

                  {expandido && (
                    <div className="flex flex-col gap-[8px] mt-[12px]">
                      {/* PATCH /mesas/{id}/estado pide encargado o mozo (T26-195): recepcion
                          y limpieza no corrigen estados a mano. */}
                      {puedeCambiarEstado(rol) &&
                        Object.entries(ETIQUETA_POR_ESTADO).map(([estado, etiqueta]) => (
                          <button
                            key={estado}
                            data-testid={`panel-mesa-estado-${estado}`}
                            disabled={accionando || estado === mesa.estado}
                            onClick={() => {
                              onEstadoChange(mesa.id, estado)
                              setExpandido(false)
                            }}
                            style={estiloBotonAccion(
                              COLOR_POR_ESTADO[estado] ?? "var(--color-slate-300)",
                              accionando || estado === mesa.estado
                            )}
                          >
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 3,
                                backgroundColor: COLOR_POR_ESTADO[estado] ?? "var(--color-gris-desconocido)",
                                display: "inline-block",
                                marginRight: 8,
                                flexShrink: 0,
                              }}
                            />
                            {etiqueta}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}

const etiquetaStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-slate-400)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 8,
}

function estiloBotonAccion(colorBorde: string, deshabilitado: boolean): CSSProperties {
  return {
    minHeight: 44,
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${colorBorde}`,
    backgroundColor: "var(--color-blanco)",
    color: "var(--color-slate-700)",
    fontSize: 13,
    fontWeight: 600,
    cursor: deshabilitado ? "default" : "pointer",
    opacity: deshabilitado ? 0.5 : 1,
    textAlign: "left",
    display: "flex",
    alignItems: "center",
  }
}

/**
 * Convierte la hora tecleada ("21:00") en un instante ISO absoluto, o null si está vacía.
 *
 * Esta función es la razón por la que la reserva no se corre tres horas. El backend guarda
 * un momento absoluto —no un texto de reloj— y corre en UTC; si se le mandara "21:00"
 * pelado, lo leería como las 21:00 UTC, o sea las 18:00 de acá. Armando el Date con los
 * componentes locales, el navegador resuelve el huso del local y toISOString() manda el
 * instante que corresponde.
 *
 * Se asume HOY. Una reserva para mañana necesitaría también la fecha, y el campo de hora
 * sola es lo que se pidió; si la hora ya pasó, el salón lo muestra como atraso, que es
 * información correcta y no un error.
 */
function momentoDeHoy(hora: string): string | null {
  if (!hora) return null
  const [h, m] = hora.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const momento = new Date()
  momento.setHours(h, m, 0, 0)
  return momento.toISOString()
}
