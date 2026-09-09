// Panel principal de TableTracker con canvas 2D del salón del restaurante.
// Carga mesas y sectores, los agrupa, y orquesta los cambios de estado y posición.

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Pencil, Menu } from "lucide-react"
import { mesasApi, sectoresApi, configuracionApi, extraerDetalle } from "../services/api"
import type { Mesa, Sector, Modo, Configuracion } from "../types"
import SalonCanvas from "../components/SalonCanvas"
import ModalAltaSector from "../components/ModalAltaSector"
import ModalAltaMesa from "../components/ModalAltaMesa"
import MenuLateral from "../components/MenuLateral"
import { useAuth } from "../hooks/useAuth"
import { esAdmin, puedeEditarLayout } from "../permisos"
import { labelStyle } from "../components/RangoFechas"
import { ETIQUETA_POR_ESTADO } from "../constants"

// Cada cuánto se refresca el estado de las mesas en modo monitoreo, para reflejar
// los cambios que escribe vision-module sin que alguien tenga que recargar la
// página. 3s da margen de sobra frente a los 6s de CONFIRMACION_SEGUNDOS por
// defecto del módulo de visión (docs/vision-loop.md): el cambio nunca tarda más
// de un intervalo en aparecer una vez confirmado.
const INTERVALO_REFRESCO_MESAS_MS = 3000

// Opciones del filtro por estado (RF-15). Se derivan de ETIQUETA_POR_ESTADO en vez de
// repetir los cuatro pares acá: ese mapa ya es la fuente de las etiquetas que el usuario
// ve en el canvas y en el panel de mesa, y duplicarlo abriría la puerta a que el filtro
// diga "Pendiente de limpieza" y la mesa diga otra cosa. El orden de las claves del
// objeto es el de inserción (libre, ocupada, pendiente_limpieza, reservada), que es el
// que corresponde al ciclo de vida de una mesa.
const OPCIONES_ESTADO = Object.entries(ETIQUETA_POR_ESTADO)

// Valor del filtro que significa "no filtrar". Cadena vacía y no null para poder usarlo
// tal cual como value del <option>, igual que hacen los filtros de Historial y Rotación.
const SIN_FILTRO = ""

// El header pasó a position:fixed para quedar visible al scrollear un salón
// grande; con altura fija se puede compensar con un spacer del mismo tamaño
// en vez de medirla en runtime.
const ALTURA_HEADER = 68

export default function DashboardPage() {
  // El usuario sale del contexto y no de un authApi.me() propio: es la misma respuesta
  // que ya resolvió AuthProvider una vez para todo el árbol.
  const { user, rol } = useAuth()
  const [sectores, setSectores] = useState<Sector[]>([])
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>("monitoreo")
  const [modalAbierto, setModalAbierto] = useState<"sector" | "mesa" | null>(null)
  const [menuAbierto, setMenuAbierto] = useState(false)
  // Filtro por estado (RF-15). Se resuelve contra el backend (GET /mesas?estado=...), no
  // recortando el array en el cliente: el endpoint ya lo soporta y así el canvas no
  // recibe mesas que no va a dibujar.
  const [estadoFiltro, setEstadoFiltro] = useState<string>(SIN_FILTRO)
  // El spinner de "Cargando salón..." solo tiene sentido la primera vez. Al cambiar el
  // filtro el canvas ya está dibujado, y desmontarlo por unos milisegundos se ve como un
  // parpadeo del salón entero.
  const yaCargoUnaVez = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!yaCargoUnaVez.current) setLoading(true)
    setError(null)
    Promise.all([
      mesasApi.listar(estadoFiltro ? { estado: estadoFiltro } : undefined),
      sectoresApi.listar(),
      configuracionApi.obtener(),
    ])
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
        setError(extraerDetalle(err, "Error al cargar el salón"))
      })
      .finally(() => {
        yaCargoUnaVez.current = true
        setLoading(false)
      })
  }, [estadoFiltro])

  // Solo en monitoreo: en modo edición el usuario puede estar arrastrando una mesa
  // o un sector, y pisar `sectores` con lo que devuelve el servidor a mitad de un
  // drag se sentiría como que el canvas "tira para atrás" lo que se está moviendo.
  useEffect(() => {
    if (modo !== "monitoreo") return

    let cancelado = false

    async function refrescarMesas() {
      try {
        const { data: mesas } = await mesasApi.listar(estadoFiltro ? { estado: estadoFiltro } : undefined)
        if (cancelado) return
        const mesasBySector = new Map<number, Mesa[]>()
        mesas.forEach((m) => {
          const arr = mesasBySector.get(m.sector.id) ?? []
          arr.push(m)
          mesasBySector.set(m.sector.id, arr)
        })
        setSectores((prev) =>
          prev.map((s) => ({ ...s, mesas: mesasBySector.get(s.id) ?? [] }))
        )
      } catch {
        // Fallo de red puntual: se reintenta solo en el próximo tick, sin mostrar
        // un error intrusivo por algo que se resuelve solo la mayoría de las veces.
      }
    }

    const intervalId = setInterval(refrescarMesas, INTERVALO_REFRESCO_MESAS_MS)
    return () => {
      cancelado = true
      clearInterval(intervalId)
    }
    // estadoFiltro entra en las dependencias para que el refresco periódico siga pidiendo
    // el filtro vigente: sin esto el intervalo quedaría capturando el valor que había
    // cuando se montó el efecto y devolvería el salón completo cada 3 segundos.
  }, [modo, estadoFiltro])

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

  function handleMesaEliminada(mesaId: number) {
    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.filter((m) => m.id !== mesaId),
      }))
    )
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
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 150,
          height: ALTURA_HEADER,
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Solo quien puede escribir el layout ve la puerta de entrada al modo edición.
              El criterio es puedeEditarLayout (admin + encargado) y no esAdmin: mover y
              crear mesas/sectores pide `encargado` en el backend, así que gatearlo con
              "solo admin" dejaría al encargado sin su tarea (docs/roles-permisos.md). */}
          {modo === "monitoreo" && puedeEditarLayout(rol) && (
            <button
              onClick={() => {
                // Se limpia el filtro al entrar en edición: acomodar el salón con mesas
                // escondidas es peligroso —se puede soltar una encima de otra que no se
                // ve— y además el filtro es una herramienta de monitoreo, no de armado.
                setEstadoFiltro(SIN_FILTRO)
                setModo("edicion")
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 44,
                padding: "0 16px",
                borderRadius: 8,
                border: "none",
                backgroundColor: "#1976d2",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Pencil size={16} />
              Editar disposición
            </button>
          )}
          <button
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              border: "none",
              borderRadius: 10,
              backgroundColor: "#f1f5f9",
              color: "#1a1a1a",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* Compensa el header fijo: sin esto el contenido de abajo arrancaría tapado. */}
      <div style={{ height: ALTURA_HEADER }} />

      {modo === "edicion" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "8px 16px",
            backgroundColor: "#eff6ff",
            borderBottom: "1px solid #bfdbfe",
            color: "#1d4ed8",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <Pencil size={14} />
          Editando disposición del salón
        </div>
      )}

      {modo === "edicion" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            border: "4px solid #1d4ed8",
            pointerEvents: "none",
          }}
        />
      )}

      <main style={{ padding: 24, paddingBottom: modo === "edicion" ? 96 : 24 }}>
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
        {/* Solo en monitoreo: en edición el filtro se limpia al entrar (ver el botón
            "Editar disposición") y mostrar el control ahí invitaría a re-filtrar
            justo cuando conviene ver el salón completo. */}
        {!loading && !error && configuracion && modo === "monitoreo" && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 16,
              flexWrap: "wrap",
              backgroundColor: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}
          >
            <label style={labelStyle}>
              Estado
              <select
                data-testid="dashboard-filtro-estado"
                value={estadoFiltro}
                onChange={(e) => setEstadoFiltro(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", minWidth: 200 }}
              >
                <option value={SIN_FILTRO}>Todos los estados</option>
                {OPCIONES_ESTADO.map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </label>

            {/* Un salón filtrado se ve igual que un salón al que le faltan mesas. El aviso
                existe para que esa diferencia no dependa de que el usuario recuerde que
                dejó un filtro puesto. */}
            {estadoFiltro !== SIN_FILTRO && (
              <span
                data-testid="dashboard-filtro-aviso"
                style={{ fontSize: 13, color: "#1d4ed8", paddingBottom: 6 }}
              >
                Mostrando solo mesas en «{ETIQUETA_POR_ESTADO[estadoFiltro]}».{" "}
                <button
                  data-testid="dashboard-filtro-limpiar"
                  onClick={() => setEstadoFiltro(SIN_FILTRO)}
                  style={{
                    border: "none",
                    background: "none",
                    padding: 0,
                    color: "#1d4ed8",
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  Ver todas
                </button>
              </span>
            )}
          </div>
        )}

        {!loading && !error && configuracion && (
          <SalonCanvas
            sectores={sectores}
            modo={modo}
            anchoSalon={configuracion.ancho_salon}
            altoSalon={configuracion.alto_salon}
            esAdmin={esAdmin(rol)}
            // Sale de la configuración que esta pantalla ya carga para el tamaño del
            // salón: no agrega ninguna request al ciclo de refresco (T26-173).
            umbralLimpiezaMinutos={configuracion.minutos_limpieza_demorada}
            onMesaEstadoChange={handleMesaEstadoChange}
            onMesaPosicionChange={handleMesaPosicionChange}
            onSectorPosicionChange={handleSectorPosicionChange}
            onSectorResize={handleSectorResize}
            onSectorActualizado={handleSectorActualizado}
            onSectorEliminado={handleSectorEliminado}
            onMesaActualizada={handleMesaActualizada}
            onMesaEliminada={handleMesaEliminada}
            onSalonResize={handleSalonResize}
          />
        )}
      </main>

      {modo === "edicion" && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 97,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "12px 16px",
            backgroundColor: "#fff",
            borderTop: "2px solid #e2e8f0",
            boxShadow: "0 -4px 12px rgba(0,0,0,0.08)",
          }}
        >
          {puedeEditarLayout(rol) && (
            <>
              <button onClick={() => setModalAbierto("sector")} style={editActionBtnStyle}>
                + Nuevo sector
              </button>
              <button onClick={() => setModalAbierto("mesa")} style={editActionBtnStyle}>
                + Nueva mesa
              </button>
            </>
          )}
          {/* Sin gate: es la única salida del modo edición. Esconderla ante un rol sin
              permiso lo dejaría encerrado en una pantalla que no puede usar. */}
          <button onClick={() => setModo("monitoreo")} style={editExitBtnStyle}>
            Salir de edición
          </button>
        </div>
      )}

      <MenuLateral
        abierto={menuAbierto}
        onClose={() => setMenuAbierto(false)}
        nombre={user?.nombre ?? ""}
        rol={rol ?? ""}
        esAdmin={esAdmin(rol)}
        onVerHistorial={() => navigate("/historial")}
        onVerOcupacion={() => navigate("/ocupacion")}
        onVerRotacion={() => navigate("/rotacion")}
        onCamaras={() => navigate("/camaras")}
        onCalibrarRoi={() => navigate("/calibracion-roi")}
        onConfiguracion={() => navigate("/configuracion")}
        onUsuarios={() => navigate("/usuarios")}
        onLogout={handleLogout}
      />

      {modalAbierto === "sector" && (
        <ModalAltaSector onClose={() => setModalAbierto(null)} onSectorCreado={handleSectorCreado} />
      )}
      {modalAbierto === "mesa" && (
        <ModalAltaMesa sectores={sectores} onClose={() => setModalAbierto(null)} onMesaCreada={handleMesaCreada} />
      )}
    </div>
  )
}

const editActionBtnStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 8,
  border: "2px solid #1976d2",
  backgroundColor: "#fff",
  color: "#1976d2",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
}

const editExitBtnStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 8,
  border: "none",
  backgroundColor: "#1a1a1a",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
}
