// Pantalla de ABM de cámaras (T26-126). Estados cargandoInicial/errorInicial, banners de
// error/éxito y extraerDetalle para parsear errores, igual que CalibracionRoiPage.tsx
// (T26-128). Acceso restringido a admin (ver AdminRoute en App.tsx), igual que /camaras en
// el backend (requiere_rol("admin")). El encabezado y la navegación los pone Layout.

import { useEffect, useState } from "react"
import { camarasApi, sectoresApi, extraerDetalle } from "../services/api"
import type { Camara, Sector, CamaraTestResponse } from "../types"
import ModalAltaCamara from "../components/ModalAltaCamara"
import ModalEditarCamara from "../components/ModalEditarCamara"
import ModalConfirmacion from "../components/ModalConfirmacion"
import CamaraEnVivo from "../components/CamaraEnVivo"
import Layout from "../components/Layout"
import Boton from "../components/ui/Boton"

interface EstadoTest {
  probando: boolean
  resultado: CamaraTestResponse | null
  error: string | null
  // Cuenta de pruebas de esta cámara. Sube en cada una y se usa como key de CamaraEnVivo,
  // para que volver a probar abra un stream nuevo en vez de reusar el anterior, que puede
  // haber quedado cortado.
  intento: number
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

  const [sectores, setSectores] = useState<Sector[]>([])
  const [camaras, setCamaras] = useState<Camara[]>([])
  const [cargandoInicial, setCargandoInicial] = useState(true)
  const [errorInicial, setErrorInicial] = useState<string | null>(null)

  const [sectorFiltro, setSectorFiltro] = useState<number | "">("")
  const [errorCamaras, setErrorCamaras] = useState<string | null>(null)

  const [modalAbierto, setModalAbierto] = useState<"alta" | "editar" | null>(null)
  const [camaraEditando, setCamaraEditando] = useState<Camara | null>(null)

  // La cámara que está esperando confirmación para desactivarse, o null (T26-200/F-10).
  const [camaraADesactivar, setCamaraADesactivar] = useState<Camara | null>(null)
  const [desactivando, setDesactivando] = useState<Record<number, boolean>>({})
  const [testsPorCamara, setTestsPorCamara] = useState<Record<number, EstadoTest>>({})

  useEffect(() => {
    Promise.all([camarasApi.listar(), sectoresApi.listar()])
      .then(([camarasRes, sectoresRes]) => {
        setCamaras(camarasRes.data)
        setSectores(sectoresRes.data)
      })
      .catch(async (err: unknown) => {
        setErrorInicial(await extraerDetalle(err, "No se pudieron cargar las cámaras"))
      })
      .finally(() => setCargandoInicial(false))
  }, [])

  async function cargarCamaras(sectorId: number | "") {
    try {
      const { data } = await camarasApi.listar(sectorId === "" ? undefined : { sector_id: sectorId })
      setCamaras(data)
      setErrorCamaras(null)
    } catch (err) {
      setErrorCamaras(await extraerDetalle(err, "No se pudieron cargar las cámaras"))
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

  function handleDesactivar(camara: Camara) {
    setCamaraADesactivar(camara)
  }

  async function desactivarConfirmada(camara: Camara) {
    setDesactivando((prev) => ({ ...prev, [camara.id]: true }))
    try {
      await camarasApi.desactivar(camara.id)
      setCamaras((prev) => prev.filter((c) => c.id !== camara.id))
      setCamaraADesactivar(null)
    } catch (err) {
      // El error va al banner de la lista, que es donde esta pantalla ya muestra los suyos
      // (T26-200/F-9); el modal se cierra para no tapar el mensaje.
      setCamaraADesactivar(null)
      setErrorCamaras(await extraerDetalle(err, "No se pudo desactivar la cámara"))
    } finally {
      setDesactivando((prev) => ({ ...prev, [camara.id]: false }))
    }
  }

  async function handleProbarConexion(camaraId: number) {
    const intento = (testsPorCamara[camaraId]?.intento ?? 0) + 1
    setTestsPorCamara((prev) => ({
      ...prev,
      [camaraId]: { probando: true, resultado: null, error: null, intento },
    }))
    try {
      const { data } = await camarasApi.testConexion(camaraId)
      // Siempre 200: que la cámara no responda (ok=false) no es un error de red, es el
      // resultado de la prueba. El mensaje ya viene redactado en español, se muestra tal cual.
      setTestsPorCamara((prev) => ({
        ...prev,
        [camaraId]: { probando: false, resultado: data, error: null, intento },
      }))
    } catch (err) {
      const mensaje = await extraerDetalle(err, "No se pudo probar la conexión")
      setTestsPorCamara((prev) => ({
        ...prev,
        [camaraId]: { probando: false, resultado: null, error: mensaje, intento },
      }))
    }
  }

  return (
    // "+ Nueva cámara" sube al encabezado: es la acción principal de la pantalla y estaba
    // al final de la fila de filtros, donde se leía como un control de filtrado más.
    <Layout
      acciones={
        !cargandoInicial && !errorInicial ? (
          <Boton variante="primario" onClick={() => setModalAbierto("alta")}>
            + Nueva cámara
          </Boton>
        ) : undefined
      }
    >
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
                        <Boton
                          onClick={() => handleProbarConexion(camara.id)}
                          cargando={test?.probando}
                          textoCargando="Probando..."
                        >
                          Probar conexión
                        </Boton>
                        <Boton onClick={() => handleEditarClick(camara)}>Editar</Boton>
                        <Boton
                          variante="peligro"
                          onClick={() => handleDesactivar(camara)}
                          cargando={desactivando[camara.id]}
                          textoCargando="Desactivando..."
                        >
                          Desactivar
                        </Boton>
                      </div>
                    </div>

                    {/* La vista en vivo va al lado del mensaje y solo cuando la conexión
                        dio bien: si la cámara no respondió no hay stream que abrir. Se monta
                        con key={intento} para que volver a probar reinicie la conexión en vez
                        de reusar la anterior, que puede haber quedado cortada. */}
                    {test?.resultado && (
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <p style={{ ...(test.resultado.ok ? estiloExito : estiloError), flex: 1, minWidth: 240 }}>
                          {test.resultado.mensaje}
                        </p>
                        {test.resultado.ok && (
                          <CamaraEnVivo key={test.intento} camaraId={camara.id} nombre={camara.nombre} />
                        )}
                      </div>
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
      {camaraADesactivar && (
        <ModalConfirmacion
          titulo="Desactivar cámara"
          mensaje={`¿Desactivar la cámara "${camaraADesactivar.nombre}"?`}
          etiquetaConfirmar={desactivando[camaraADesactivar.id] ? "Desactivando..." : "Desactivar"}
          ocupado={desactivando[camaraADesactivar.id] ?? false}
          onConfirmar={() => desactivarConfirmada(camaraADesactivar)}
          onCancelar={() => setCamaraADesactivar(null)}
        />
      )}
    </Layout>
  )
}
