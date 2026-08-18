// Panel principal de TableTracker con canvas 2D del salón del restaurante.
// Carga mesas y sectores, los agrupa, y orquesta los cambios de estado y posición.

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { authApi, mesasApi, sectoresApi, configuracionApi } from "../services/api"
import type { UserResponse } from "../services/api"
import type { Mesa, Sector, Modo, Configuracion } from "../types"
import SalonCanvas from "../components/SalonCanvas"
import ModalAltaSector from "../components/ModalAltaSector"
import ModalAltaMesa from "../components/ModalAltaMesa"

export default function DashboardPage() {
  const [user, setUser] = useState<UserResponse | null>(null)
  const [sectores, setSectores] = useState<Sector[]>([])
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>("monitoreo")
  const [modalAbierto, setModalAbierto] = useState<"sector" | "mesa" | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    authApi.me().then((res) => setUser(res.data)).catch(() => navigate("/login"))
  }, [navigate])

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([mesasApi.listar(), sectoresApi.listar(), configuracionApi.obtener()])
      .then(([mesasRes, sectoresRes, configuracionRes]) => {
        const mesas: Mesa[] = mesasRes.data
        const rawSectores: Sector[] = sectoresRes.data
        const mesasBySector = new Map<number, Mesa[]>()
        mesas.forEach((m) => {
          const arr = mesasBySector.get(m.sector.id) ?? []
          arr.push(m)
          mesasBySector.set(m.sector.id, arr)
        })
        setSectores(
          rawSectores.map((s) => ({ ...s, mesas: mesasBySector.get(s.id) ?? [] }))
        )
        setConfiguracion(configuracionRes.data)
      })
      .catch((err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        setError(detail ?? "Error al cargar el salón")
      })
      .finally(() => setLoading(false))
  }, [])

  function extraerDetalle(err: unknown, fallback: string) {
    return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
  }

  function handleMesaEstadoChange(mesaId: number, nuevoEstado: string) {
    const estadoAnterior = sectores.flatMap((s) => s.mesas ?? []).find((m) => m.id === mesaId)?.estado

    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.map((m) => (m.id === mesaId ? { ...m, estado: nuevoEstado } : m)),
      }))
    )

    mesasApi.cambiarEstado(mesaId, nuevoEstado).catch((err) => {
      setSectores((prev) =>
        prev.map((s) => ({
          ...s,
          mesas: s.mesas?.map((m) => (m.id === mesaId && estadoAnterior !== undefined ? { ...m, estado: estadoAnterior } : m)),
        }))
      )
      alert(extraerDetalle(err, "Error al cambiar el estado de la mesa"))
    })
  }

  function handleMesaPosicionChange(mesaId: number, pos_x: number, pos_y: number) {
    const posAnterior = sectores.flatMap((s) => s.mesas ?? []).find((m) => m.id === mesaId)

    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.map((m) => (m.id === mesaId ? { ...m, pos_x, pos_y } : m)),
      }))
    )

    mesasApi.cambiarPosicion(mesaId, pos_x, pos_y).catch((err) => {
      setSectores((prev) =>
        prev.map((s) => ({
          ...s,
          mesas: s.mesas?.map((m) =>
            m.id === mesaId && posAnterior ? { ...m, pos_x: posAnterior.pos_x, pos_y: posAnterior.pos_y } : m
          ),
        }))
      )
      alert(extraerDetalle(err, "Error al mover la mesa"))
    })
  }

  function handleSectorPosicionChange(sectorId: number, pos_x: number, pos_y: number) {
    const posAnterior = sectores.find((s) => s.id === sectorId)

    setSectores((prev) => prev.map((s) => (s.id === sectorId ? { ...s, pos_x, pos_y } : s)))

    sectoresApi.actualizar(sectorId, { pos_x, pos_y }).catch((err) => {
      setSectores((prev) =>
        prev.map((s) =>
          s.id === sectorId && posAnterior ? { ...s, pos_x: posAnterior.pos_x, pos_y: posAnterior.pos_y } : s
        )
      )
      alert(extraerDetalle(err, "Error al mover el sector"))
    })
  }

  function handleSectorResize(sectorId: number, ancho: number, alto: number) {
    const sizeAnterior = sectores.find((s) => s.id === sectorId)

    setSectores((prev) => prev.map((s) => (s.id === sectorId ? { ...s, ancho, alto } : s)))

    sectoresApi.actualizar(sectorId, { ancho, alto }).catch((err) => {
      setSectores((prev) =>
        prev.map((s) =>
          s.id === sectorId && sizeAnterior ? { ...s, ancho: sizeAnterior.ancho, alto: sizeAnterior.alto } : s
        )
      )
      alert(extraerDetalle(err, "Error al redimensionar el sector"))
    })
  }

  function handleSalonResize(ancho_salon: number, alto_salon: number) {
    const anterior = configuracion

    setConfiguracion((prev) => (prev ? { ...prev, ancho_salon, alto_salon } : prev))

    configuracionApi.actualizar({ ancho_salon, alto_salon }).catch((err) => {
      setConfiguracion(anterior)
      alert(extraerDetalle(err, "Error al redimensionar el salón"))
    })
  }

  function handleSectorActualizado(sectorActualizado: Sector) {
    setSectores((prev) => prev.map((s) => (s.id === sectorActualizado.id ? sectorActualizado : s)))
  }

  function handleSectorEliminado(sectorId: number) {
    setSectores((prev) => prev.filter((s) => s.id !== sectorId))
  }

  function handleMesaActualizada(mesaActualizada: Mesa) {
    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.map((m) => (m.id === mesaActualizada.id ? mesaActualizada : m)),
      }))
    )
  }

  function handleSectorCreado(sector: Sector) {
    setSectores((prev) => [...prev, sector])
    setModalAbierto(null)
  }

  function handleMesaCreada(mesa: Mesa) {
    setSectores((prev) =>
      prev.map((s) => (s.id === mesa.sector.id ? { ...s, mesas: [...(s.mesas ?? []), mesa] } : s))
    )
    setModalAbierto(null)
  }

  function handleLogout() {
    localStorage.removeItem("token")
    navigate("/login")
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
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
          TableTracker
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {user && (
            <span style={{ fontSize: 14, color: "#666" }}>
              {user.nombre} ·{" "}
              <span style={{ textTransform: "capitalize" }}>{user.rol}</span>
            </span>
          )}
          <button
            onClick={() => navigate("/historial")}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #1976d2",
              fontSize: 13,
              cursor: "pointer",
              backgroundColor: "#fff",
              color: "#1976d2",
              fontWeight: 500,
            }}
          >
            Ver historial
          </button>
          {user?.rol === "admin" && (
            <button
              onClick={() => navigate("/calibracion-roi")}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #1976d2",
                fontSize: 13,
                cursor: "pointer",
                backgroundColor: "#fff",
                color: "#1976d2",
                fontWeight: 500,
              }}
            >
              Calibrar ROI
            </button>
          )}
          <button
            onClick={() => setModo((m) => (m === "monitoreo" ? "edicion" : "monitoreo"))}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #1976d2",
              fontSize: 13,
              cursor: "pointer",
              backgroundColor: modo === "edicion" ? "#1976d2" : "#fff",
              color: modo === "edicion" ? "#fff" : "#1976d2",
              fontWeight: 500,
              transition: "background-color 0.15s, color 0.15s",
            }}
          >
            {modo === "monitoreo" ? "Editar disposición" : "Ver monitoreo"}
          </button>
          {modo === "edicion" && (
            <>
              <button
                onClick={() => setModalAbierto("sector")}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #1976d2",
                  fontSize: 13,
                  cursor: "pointer",
                  backgroundColor: "#fff",
                  color: "#1976d2",
                  fontWeight: 500,
                }}
              >
                + Nuevo sector
              </button>
              <button
                onClick={() => setModalAbierto("mesa")}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #1976d2",
                  fontSize: 13,
                  cursor: "pointer",
                  backgroundColor: "#fff",
                  color: "#1976d2",
                  fontWeight: 500,
                }}
              >
                + Nueva mesa
              </button>
            </>
          )}
          <button
            onClick={handleLogout}
            style={{
              fontSize: 13,
              color: "#e53935",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <main style={{ padding: 24 }}>
        {loading && (
          <p style={{ fontSize: 14, color: "#888" }}>Cargando salón...</p>
        )}
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
        {!loading && !error && configuracion && (
          <SalonCanvas
            sectores={sectores}
            modo={modo}
            anchoSalon={configuracion.ancho_salon}
            altoSalon={configuracion.alto_salon}
            esAdmin={user?.rol === "admin"}
            onMesaEstadoChange={handleMesaEstadoChange}
            onMesaPosicionChange={handleMesaPosicionChange}
            onSectorPosicionChange={handleSectorPosicionChange}
            onSectorResize={handleSectorResize}
            onSectorActualizado={handleSectorActualizado}
            onSectorEliminado={handleSectorEliminado}
            onMesaActualizada={handleMesaActualizada}
            onSalonResize={handleSalonResize}
          />
        )}
      </main>

      {modalAbierto === "sector" && (
        <ModalAltaSector onClose={() => setModalAbierto(null)} onSectorCreado={handleSectorCreado} />
      )}
      {modalAbierto === "mesa" && (
        <ModalAltaMesa sectores={sectores} onClose={() => setModalAbierto(null)} onMesaCreada={handleMesaCreada} />
      )}
    </div>
  )
}
