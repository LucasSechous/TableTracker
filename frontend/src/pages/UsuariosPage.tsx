// Pantalla de administración de usuarios (T26-175): listado, cambio de rol y baja
// lógica. Estructura calcada de CamarasPage.tsx (header, banners de error/éxito,
// extraerDetalleApi). Acceso restringido a admin, igual que /usuarios en el backend
// (requiere_rol("admin")) — ver AdminRoute en App.tsx.
//
// Las salvaguardas (no admin auto-desactivarse, no dejar el sistema sin admin activo,
// no desactivar la cuenta de vision-module) las aplica el backend con 409: esta
// pantalla deshabilita en la UI lo que sabe de antemano que va a fallar (la fila
// propia, la cuenta de servicio), pero el mensaje de error real siempre viene del
// backend por si se cuela algo (ej. el último admin, que acá no se puede calcular
// sin otra request).

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ShieldAlert } from "lucide-react"
import { usuariosApi, extraerDetalleApi } from "../services/api"
import type { UsuarioAdmin } from "../types"
import { useAuth } from "../hooks/useAuth"

// Valores de rol usados en el resto del sistema (docs/roles-permisos.md). No hay
// enum ni CHECK del lado del backend —sigue siendo un String libre, a propósito
// fuera de alcance de este ticket—, así que este select es una ayuda de la UI para
// no repetir el typo documentado ("admim") que deja a alguien sin poder pasar
// ningún requiere_rol(...), no una validación real.
const ROLES = ["admin", "encargado", "mozo", "recepcion", "limpieza", "vision_module"] as const

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

export default function UsuariosPage() {
  const navigate = useNavigate()

  // El usuario propio sale del contexto y no de un authApi.me() de esta pantalla: es la
  // misma respuesta que AuthProvider ya resolvió una sola vez para todo el árbol. Antes acá
  // vivían un estado `miId` y un efecto que repetían ese GET /auth/me en cada visita.
  const { user } = useAuth()

  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([])
  const [incluirInactivos, setIncluirInactivos] = useState(false)
  const [cargandoInicial, setCargandoInicial] = useState(true)
  const [errorInicial, setErrorInicial] = useState<string | null>(null)
  const [errorFila, setErrorFila] = useState<Record<number, string | null>>({})
  const [guardando, setGuardando] = useState<Record<number, boolean>>({})

  useEffect(() => {
    cargar(incluirInactivos, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incluirInactivos])

  async function cargar(conInactivos: boolean, esInicial = false) {
    if (esInicial) setCargandoInicial(true)
    try {
      const { data } = await usuariosApi.listar({ incluir_inactivos: conInactivos })
      setUsuarios(data)
      setErrorInicial(null)
    } catch (err) {
      setErrorInicial(await extraerDetalleApi(err, "No se pudieron cargar los usuarios"))
    } finally {
      if (esInicial) setCargandoInicial(false)
    }
  }

  async function aplicarCambio(usuario: UsuarioAdmin, datos: { rol?: string; activo?: boolean }) {
    setGuardando((prev) => ({ ...prev, [usuario.id]: true }))
    setErrorFila((prev) => ({ ...prev, [usuario.id]: null }))
    try {
      await usuariosApi.actualizar(usuario.id, datos)
      // Recarga en vez de pisar la fila en memoria: con incluirInactivos apagado (el
      // default), desactivar a alguien tiene que sacarlo de la lista, no dejarlo con
      // la marca "inactivo" puesta pero visible pese al filtro.
      await cargar(incluirInactivos)
    } catch (err) {
      const mensaje = await extraerDetalleApi(err, "No se pudo actualizar el usuario")
      setErrorFila((prev) => ({ ...prev, [usuario.id]: mensaje }))
    } finally {
      setGuardando((prev) => ({ ...prev, [usuario.id]: false }))
    }
  }

  function handleCambiarRol(usuario: UsuarioAdmin, rol: string) {
    if (rol === usuario.rol) return
    aplicarCambio(usuario, { rol })
  }

  function handleToggleActivo(usuario: UsuarioAdmin) {
    const accion = usuario.activo ? "desactivar" : "reactivar"
    if (!window.confirm(`¿${accion === "desactivar" ? "Desactivar" : "Reactivar"} a "${usuario.nombre}"?`)) return
    aplicarCambio(usuario, { activo: !usuario.activo })
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
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Usuarios</h1>
        <button onClick={() => navigate("/")} style={estiloBoton}>
          Volver al salón
        </button>
      </header>

      <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        {cargandoInicial && <p style={{ fontSize: 14, color: "#888" }}>Cargando usuarios...</p>}
        {errorInicial && <p style={estiloError}>{errorInicial}</p>}

        {!cargandoInicial && !errorInicial && (
          <>
            <label style={{ fontSize: 13, color: "#555", display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={incluirInactivos}
                onChange={(e) => setIncluirInactivos(e.target.checked)}
              />
              Mostrar usuarios dados de baja
            </label>

            {usuarios.length === 0 && (
              <p style={{ fontSize: 13, color: "#666" }}>No hay usuarios con este filtro.</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {usuarios.map((usuario) => {
                // Mientras useAuth() resuelve la sesión, user es null y esto da false: el
                // botón arranca habilitado y se deshabilita al confirmarse cuál es la cuenta
                // propia. Es el mismo comportamiento que tenía con `miId` en null.
                const esUnoMismo = usuario.id === user?.id
                // Regla del backend (T26-175): la cuenta de servicio de vision-module no se
                // puede desactivar, sea cual sea su rol actual — se deshabilita el botón acá
                // para no dejar que alguien dispare el 409 sin saber por qué.
                const bloquearDesactivar = esUnoMismo || (usuario.activo && usuario.es_cuenta_servicio)

                return (
                  <div
                    key={usuario.id}
                    style={{
                      backgroundColor: "#fff",
                      border: "1px solid #eee",
                      borderRadius: 8,
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      opacity: usuario.activo ? 1 : 0.6,
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
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", display: "flex", alignItems: "center", gap: 6 }}>
                          {usuario.nombre}
                          {esUnoMismo && (
                            <span style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>(vos)</span>
                          )}
                          {usuario.es_cuenta_servicio && (
                            <span
                              title="Cuenta de servicio del módulo de visión: si se desactiva, la detección se detiene."
                              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#8a6d0b" }}
                            >
                              <ShieldAlert size={13} />
                              cuenta de servicio
                            </span>
                          )}
                          {!usuario.activo && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#c62828" }}>· inactivo</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#888" }}>{usuario.email}</div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <select
                          value={usuario.rol}
                          disabled={esUnoMismo || guardando[usuario.id]}
                          onChange={(e) => handleCambiarRol(usuario, e.target.value)}
                          style={estiloSelect}
                        >
                          {/* Si el rol actual no está en la lista curada (typo viejo, o un valor
                              cargado directo en la base) se agrega igual para no perderlo del
                              select ni forzar un cambio no pedido. */}
                          {!ROLES.includes(usuario.rol as (typeof ROLES)[number]) && (
                            <option value={usuario.rol}>{usuario.rol}</option>
                          )}
                          {ROLES.map((rol) => (
                            <option key={rol} value={rol}>
                              {rol}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => handleToggleActivo(usuario)}
                          disabled={guardando[usuario.id] || (usuario.activo && bloquearDesactivar)}
                          style={{
                            ...(usuario.activo ? estiloBotonPeligro : estiloBoton),
                            opacity: guardando[usuario.id] || (usuario.activo && bloquearDesactivar) ? 0.5 : 1,
                          }}
                        >
                          {guardando[usuario.id] ? "Guardando..." : usuario.activo ? "Desactivar" : "Reactivar"}
                        </button>
                      </div>
                    </div>

                    {errorFila[usuario.id] && <p style={estiloError}>{errorFila[usuario.id]}</p>}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
