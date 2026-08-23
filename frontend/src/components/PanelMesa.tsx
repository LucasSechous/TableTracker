// Panel lateral deslizante con el detalle de una mesa: estado actual, tiempo
// transcurrido en ese estado y la corrección manual (RF-17), colapsada por
// defecto para no competir visualmente con la detección automática.
// No muestra origen automático/manual: ese dato no existe todavía en el
// modelo (ver ticket de backend pendiente para T26-138).

import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import type { AxiosError } from "axios"
import type { Mesa } from "../types"
import { historialApi, mesasApi } from "../services/api"
import { COLOR_POR_ESTADO } from "../constants"

const ETIQUETA_POR_ESTADO: Record<string, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pendiente_limpieza: "Pendiente de limpieza",
  reservada: "Reservada",
}

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
  const [desde, setDesde] = useState<Date | null>(null)
  const [expandido, setExpandido] = useState(false)
  const [accionando, setAccionando] = useState(false)
  const [, forceTick] = useState(0)

  const abierto = mesa !== null

  useEffect(() => {
    setExpandido(false)
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
      const axiosErr = err as AxiosError<{ detail?: string }>
      alert(axiosErr.response?.data?.detail ?? "No se pudo cambiar el estado de la mesa")
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
          backgroundColor: "#fff",
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
              style={{
                padding: 20,
                borderBottom: "2px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                Mesa {mesa.numero} · {mesa.sector.nombre}
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                style={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  border: "none",
                  background: "#f1f5f9",
                  borderRadius: 10,
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              <div style={{ marginBottom: 24 }}>
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
                    backgroundColor: `${COLOR_POR_ESTADO[mesa.estado] ?? "#9e9e9e"}20`,
                    color: COLOR_POR_ESTADO[mesa.estado] ?? "#616161",
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      backgroundColor: COLOR_POR_ESTADO[mesa.estado] ?? "#9e9e9e",
                      flexShrink: 0,
                    }}
                  />
                  {ETIQUETA_POR_ESTADO[mesa.estado] ?? mesa.estado}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={etiquetaStyle}>Tiempo en este estado</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1e293b" }}>
                  {desde ? formatearTranscurrido(desde) : "Calculando..."}
                </div>
              </div>

              <div>
                <button
                  onClick={() => setExpandido((v) => !v)}
                  style={{
                    minHeight: 44,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#fff",
                    color: "#475569",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {expandido ? "Ocultar corrección manual" : "Corregir estado manualmente"}
                </button>

                {expandido && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                    {mesa.estado === "pendiente_limpieza" && (
                      <button
                        disabled={accionando}
                        onClick={() => ejecutarAccion(() => mesasApi.confirmarLimpieza(mesa.id))}
                        style={estiloBotonAccion("#cbd5e1", accionando)}
                      >
                        Confirmar limpieza
                      </button>
                    )}
                    {mesa.estado !== "reservada" && (
                      <button
                        disabled={accionando}
                        onClick={() => ejecutarAccion(() => mesasApi.marcarReservada(mesa.id))}
                        style={estiloBotonAccion("#cbd5e1", accionando)}
                      >
                        Marcar como reservada
                      </button>
                    )}
                    {Object.entries(ETIQUETA_POR_ESTADO).map(([estado, etiqueta]) => (
                      <button
                        key={estado}
                        disabled={accionando || estado === mesa.estado}
                        onClick={() => {
                          onEstadoChange(mesa.id, estado)
                          setExpandido(false)
                        }}
                        style={estiloBotonAccion(
                          COLOR_POR_ESTADO[estado] ?? "#cbd5e1",
                          accionando || estado === mesa.estado
                        )}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            backgroundColor: COLOR_POR_ESTADO[estado] ?? "#9e9e9e",
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
  color: "#94a3b8",
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
    backgroundColor: "#fff",
    color: "#334155",
    fontSize: 13,
    fontWeight: 600,
    cursor: deshabilitado ? "default" : "pointer",
    opacity: deshabilitado ? 0.5 : 1,
    textAlign: "left",
    display: "flex",
    alignItems: "center",
  }
}
