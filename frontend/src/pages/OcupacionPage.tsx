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
import { PieChart, RefreshCw, LayoutGrid } from "lucide-react"
import { metricasApi, extraerDetalleApi } from "../services/api"
import type { ConteoPorEstado, OcupacionResponse } from "../types"
import { COLOR_POR_ESTADO, BORDE_POR_ESTADO } from "../constants"

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
      setError(await extraerDetalleApi(err, "Error al cargar las métricas de ocupación"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const conteo = ocupacion?.conteo_por_estado
  const salonSinMesas = ocupacion !== null && ocupacion.total_mesas === 0

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
          Ocupación del salón
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Las métricas son una foto del momento, no un stream: sin este botón la única
              forma de refrescarlas sería recargar la página entera. */}
          <button onClick={cargar} disabled={loading} style={{ ...estiloBoton, opacity: loading ? 0.6 : 1 }}>
            <RefreshCw size={15} />
            Actualizar
          </button>
          <button onClick={() => navigate("/")} style={estiloBoton}>
            Volver al salón
          </button>
        </div>
      </header>

      <main style={{ padding: 24 }}>
        {loading && <p style={{ fontSize: 14, color: "#888" }}>Cargando métricas...</p>}

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

        {/* Salón sin mesas activas: el backend devuelve 0%, pero mostrarlo como un "0% de
            ocupación" haría leer un salón vacío de gente cuando en realidad está vacío de
            mesas. Son dos cosas distintas y solo una es un dato. */}
        {!loading && !error && salonSinMesas && (
          <div
            data-testid="ocupacion-empty"
            style={{
              backgroundColor: "#fff",
              border: "1px dashed #cbd5e1",
              borderRadius: 8,
              padding: "40px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <LayoutGrid size={30} color="#94a3b8" />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", margin: 0 }}>
              Todavía no hay mesas activas
            </h2>
            <p style={{ fontSize: 14, color: "#64748b", margin: 0, maxWidth: 460, lineHeight: 1.5 }}>
              Sin mesas cargadas no hay ocupación que medir. Agregá mesas desde el modo edición
              del panel principal y las métricas aparecen acá.
            </p>
            <button onClick={() => navigate("/")} style={{ ...estiloBotonPrimario, marginTop: 6 }}>
              Ir al salón
            </button>
          </div>
        )}

        {!loading && !error && ocupacion && conteo && !salonSinMesas && (
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
                Ocupación general
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  gap: 12,
                  marginTop: 10,
                }}
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
                <span data-testid="ocupacion-resumen" style={{ fontSize: 14, color: "#475569" }}>
                  {conteo.ocupada} de {ocupacion.total_mesas} mesas ocupadas
                </span>
              </div>

              <div
                style={{
                  marginTop: 16,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: "#e2e8f0",
                  overflow: "hidden",
                }}
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
                style={{ margin: "14px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}
              >
                El porcentaje cuenta <strong>solo las mesas ocupadas</strong>. Las reservadas no
                suman: la mesa sigue físicamente libre hasta que alguien se sienta.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: 0 }}>
                Mesas por estado
              </h2>
              <span data-testid="ocupacion-total" style={{ fontSize: 13, color: "#64748b" }}>
                {`${ocupacion.total_mesas} ${ocupacion.total_mesas === 1 ? "mesa activa" : "mesas activas"} en total`}
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
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
                    backgroundColor: "#fff",
                    border: "1px solid #e0e0e0",
                    // El color vive en el borde izquierdo y en el número (tono 700 de
                    // BORDE_POR_ESTADO, legible como texto); pintar la card entera del color
                    // del estado la volvería ilegible con los rojos y verdes saturados.
                    borderLeft: `6px solid ${COLOR_POR_ESTADO[estado]}`,
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                      style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}
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
                      style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}
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
    </div>
  )
}

// Mismo lenguaje visual que los botones de HistorialPage/CamarasPage, pero con minHeight 44
// para respetar el target táctil mínimo que usa el resto de la app.
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
