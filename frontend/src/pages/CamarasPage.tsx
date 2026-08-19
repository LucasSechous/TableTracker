// Pantalla de ABM de cámaras (T26-126). Estructura calcada de CalibracionRoiPage.tsx (T26-128):
// header con "Volver", estados cargandoInicial/errorInicial, banners de error/éxito reutilizando
// los mismos estilos inline, y extraerDetalleApi para parsear errores. Acceso restringido a
// admin (ver AdminRoute en App.tsx), igual que /camaras en el backend (requiere_rol("admin")).

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { camarasApi, sectoresApi, extraerDetalleApi } from "../services/api"
import type { Camara, Sector, CamaraTestResponse } from "../types"
import ModalAltaCamara from "../components/ModalAltaCamara"
import ModalEditarCamara from "../components/ModalEditarCamara"

interface EstadoTest {
  probando: boolean
  resultado: CamaraTestResponse | null
  error: string | null
}

const estiloBoton: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid #1976d2",
  fontSize: 13,
  cursor: "pointer",
  backgroundColor: "#fff",
  color: "#1976d2",
  fontWeight: 500,
}

const estiloBotonPrimario: React.CSSProperties = {
  ...estiloBoton,
  border: "none",
  backgroundColor: "#1976d2",
  color: "#fff",
}

const estiloBotonPeligro: React.CSSProperties = {
  ...estiloBoton,
  border: "1px solid #c62828",
  color: "#c62828",
}

const estiloSelect: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid #ccc",
  borderRadius: 6,
  backgroundColor: "#fff",
}

const estiloError: React.CSSProperties = {
  fontSize: 13,
  color: "#c62828",
  backgroundColor: "#ffebee",
  border: "1px solid #ef9a9a",
  borderRadius: 6,
  padding: "8px 12px",
}

const estiloExito: React.CSSProperties = {
  fontSize: 13,
  color: "#2e7d32",
  backgroundColor: "#e8f5e9",
  border: "1px solid #a5d6a7",
  borderRadius: 6,
  padding: "8px 12px",
}

export default function CamarasPage() {
  const navigate = useNavigate()

  const [sectores, setSectores] = useState<Sector[]>([])
  const [camaras, setCamaras] = useState<Camara[]>([])
  const [cargandoInicial, setCargandoInicial] = useState(true)
  const [errorInicial, setErrorInicial] = useState<string | null>(null)

  const [sectorFiltro, setSectorFiltro] = useState<number | "">("")
  const [errorCamaras, setErrorCamaras] = useState<string | null>(null)

  const [modalAbierto, setModalAbierto] = useState<"alta" | "editar" | null>(null)
  const [camaraEditando, setCamaraEditando] = useState<Camara | null>(null)

  const [desactivando, setDesactivando] = useState<Record<number, boolean>>({})
  const [testsPorCamara, setTestsPorCamara] = useState<Record<number, EstadoTest>>({})

  useEffect(() => {
    Promise.all([camarasApi.listar(), sectoresApi.listar()])
      .then(([camarasRes, sectoresRes]) => {
        setCamaras(camarasRes.data)
        setSectores(sectoresRes.data)
      })
      .catch(async (err: unknown) => {
        setErrorInicial(await extraerDetalleApi(err, "No se pudieron cargar las cámaras"))
      })
      .finally(() => setCargandoInicial(false))
  }, [])

  async function cargarCamaras(sectorId: number | "") {
    try {
      const { data } = await camarasApi.listar(sectorId === "" ? undefined : { sector_id: sectorId })
      setCamaras(data)
      setErrorCamaras(null)
    } catch (err) {
      setErrorCamaras(await extraerDetalleApi(err, "No se pudieron cargar las cámaras"))
    }
  }

  function handleSectorFiltroChange(valor: string) {
    const id = valor === "" ? "" : Number(valor)
    setSectorFiltro(id)
    cargarCamaras(id)
  }

  function handleCamaraCreada(camara: Camara) {
    setModalAbierto(null)
    if (sectorFiltro === "" || camara.sector_id === sectorFiltro) {
      setCamaras((prev) => [...prev, camara])
    }
  }

  function handleCamaraActualizada(camara: Camara) {
    setModalAbierto(null)
    setCamaraEditando(null)
    setCamaras((prev) =>
      sectorFiltro !== "" && camara.sector_id !== sectorFiltro
        ? prev.filter((c) => c.id !== camara.id)
        : prev.map((c) => (c.id === camara.id ? camara : c))
    )
  }

  function handleEditarClick(camara: Camara) {
    setCamaraEditando(camara)
    setModalAbierto("editar")
  }

  async function handleDesactivar(camara: Camara) {
    if (!window.confirm(`¿Desactivar la cámara "${camara.nombre}"?`)) return
    setDesactivando((prev) => ({ ...prev, [camara.id]: true }))
    try {
      await camarasApi.desactivar(camara.id)
      setCamaras((prev) => prev.filter((c) => c.id !== camara.id))
    } catch (err) {
      alert(await extraerDetalleApi(err, "No se pudo desactivar la cámara"))
    } finally {
      setDesactivando((prev) => ({ ...prev, [camara.id]: false }))
    }
  }

  async function handleProbarConexion(camaraId: number) {
    setTestsPorCamara((prev) => ({ ...prev, [camaraId]: { probando: true, resultado: null, error: null } }))
    try {
      const { data } = await camarasApi.testConexion(camaraId)
      // Siempre 200: que la cámara no responda (ok=false) no es un error de red, es el
      // resultado de la prueba. El mensaje ya viene redactado en español, se muestra tal cual.
      setTestsPorCamara((prev) => ({ ...prev, [camaraId]: { probando: false, resultado: data, error: null } }))
    } catch (err) {
      const mensaje = await extraerDetalleApi(err, "No se pudo probar la conexión")
      setTestsPorCamara((prev) => ({ ...prev, [camaraId]: { probando: false, resultado: null, error: mensaje } }))
    }
  }

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
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Cámaras</h1>
        <button onClick={() => navigate("/")} style={estiloBoton}>
          Volver al salón
        </button>
      </header>

      <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        {cargandoInicial && <p style={{ fontSize: 14, color: "#888" }}>Cargando cámaras...</p>}
        {errorInicial && <p style={estiloError}>{errorInicial}</p>}

        {!cargandoInicial && !errorInicial && (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 13, color: "#555", display: "flex", flexDirection: "column", gap: 4 }}>
                Sector
                <select
                  value={sectorFiltro}
                  onChange={(e) => handleSectorFiltroChange(e.target.value)}
                  style={estiloSelect}
                >
                  <option value="">Todos los sectores</option>
                  {sectores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <button onClick={() => setModalAbierto("alta")} style={estiloBotonPrimario}>
                + Nueva cámara
              </button>
            </div>

            {errorCamaras && <p style={estiloError}>{errorCamaras}</p>}

            {camaras.length === 0 && (
              <p style={{ fontSize: 13, color: "#666" }}>No hay cámaras dadas de alta con este filtro.</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {camaras.map((camara) => {
                const test = testsPorCamara[camara.id]
                return (
                  <div
                    key={camara.id}
                    style={{
                      backgroundColor: "#fff",
                      border: "1px solid #eee",
                      borderRadius: 8,
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>{camara.nombre}</div>
                        <div style={{ fontSize: 12, color: "#888" }}>
                          {camara.sector.nombre} · <span style={{ fontFamily: "monospace" }}>{camara.rtsp_url}</span>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() => handleProbarConexion(camara.id)}
                          disabled={test?.probando}
                          style={{ ...estiloBoton, opacity: test?.probando ? 0.6 : 1 }}
                        >
                          {test?.probando ? "Probando..." : "Probar conexión"}
                        </button>
                        <button onClick={() => handleEditarClick(camara)} style={estiloBoton}>
                          Editar
                        </button>
                        <button
                          onClick={() => handleDesactivar(camara)}
                          disabled={desactivando[camara.id]}
                          style={{ ...estiloBotonPeligro, opacity: desactivando[camara.id] ? 0.6 : 1 }}
                        >
                          {desactivando[camara.id] ? "Desactivando..." : "Desactivar"}
                        </button>
                      </div>
                    </div>

                    {test?.resultado && (
                      <p style={test.resultado.ok ? estiloExito : estiloError}>{test.resultado.mensaje}</p>
                    )}
                    {test?.error && <p style={estiloError}>{test.error}</p>}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>

      {modalAbierto === "alta" && (
        <ModalAltaCamara sectores={sectores} onClose={() => setModalAbierto(null)} onCamaraCreada={handleCamaraCreada} />
      )}
      {modalAbierto === "editar" && camaraEditando && (
        <ModalEditarCamara
          camara={camaraEditando}
          sectores={sectores}
          onClose={() => {
            setModalAbierto(null)
            setCamaraEditando(null)
          }}
          onCamaraActualizada={handleCamaraActualizada}
        />
      )}
    </div>
  )
}
