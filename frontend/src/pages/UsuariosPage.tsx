// Pantalla de administración de usuarios (T26-175): listado, cambio de rol y baja
// lógica. Estructura calcada de CamarasPage.tsx (header, banners de error/éxito,
// extraerDetalle). Acceso restringido a admin, igual que /usuarios en el backend
// (requiere_rol("admin")) — ver AdminRoute en App.tsx.
//
// Las salvaguardas (no admin auto-desactivarse, no dejar el sistema sin admin activo,
// no desactivar la cuenta de vision-module) las aplica el backend con 409: esta
// pantalla deshabilita en la UI lo que sabe de antemano que va a fallar (la fila
// propia, la cuenta de servicio), pero el mensaje de error real siempre viene del
// backend por si se cuela algo (ej. el último admin, que acá no se puede calcular
// sin otra request).

import { useEffect, useState } from "react"
import { ShieldAlert } from "lucide-react"
import { usuariosApi, extraerDetalle } from "../services/api"
import type { UsuarioAdmin } from "../types"
import { useAuth } from "../hooks/useAuth"
import Layout from "../components/Layout"
import Boton from "../components/ui/Boton"
import ModalConfirmacion from "../components/ModalConfirmacion"

// Valores de rol usados en el resto del sistema (docs/roles-permisos.md). No hay
// enum ni CHECK del lado del backend —sigue siendo un String libre, a propósito
// fuera de alcance de este ticket—, así que este select es una ayuda de la UI para
// no repetir el typo documentado ("admim") que deja a alguien sin poder pasar
// ningún requiere_rol(...), no una validación real.
const ROLES = ["admin", "encargado", "mozo", "recepcion", "limpieza", "vision_module"] as const

const estiloSelect: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid var(--color-gris-250)",
  borderRadius: 6,
  backgroundColor: "var(--color-blanco)",
}

const estiloError: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-error)",
  backgroundColor: "var(--color-error-fondo)",
  border: "1px solid var(--color-error-borde)",
  borderRadius: 6,
  padding: "8px 12px",
}

export default function UsuariosPage() {
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
  // El usuario que está esperando confirmación para activarse o desactivarse (T26-200/F-10).
  const [usuarioAConfirmar, setUsuarioAConfirmar] = useState<UsuarioAdmin | null>(null)

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
      setErrorInicial(await extraerDetalle(err, "No se pudieron cargar los usuarios"))
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
      const mensaje = await extraerDetalle(err, "No se pudo actualizar el usuario")
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
    setUsuarioAConfirmar(usuario)
  }

  function confirmarToggleActivo(usuario: UsuarioAdmin) {
    // Se cierra antes de disparar: el resultado —éxito o el 409 de alguna salvaguarda— se
    // muestra en la fila del usuario, y el modal encima la taparía justo cuando aparece.
    setUsuarioAConfirmar(null)
    aplicarCambio(usuario, { activo: !usuario.activo })
  }

  return (
    <Layout>
      <main className="app-main flex flex-col gap-[16px] max-w-[900px]">
        {cargandoInicial && <p className="text-[14px] text-gris-400">Cargando usuarios...</p>}
        {errorInicial && <p style={estiloError}>{errorInicial}</p>}

        {!cargandoInicial && !errorInicial && (
          <>
            <label className="text-[13px] text-gris-600 flex items-center gap-[8px]">
              <input
                type="checkbox"
                checked={incluirInactivos}
                onChange={(e) => setIncluirInactivos(e.target.checked)}
              />
              Mostrar usuarios dados de baja
            </label>

            {usuarios.length === 0 && (
              <p className="text-[13px] text-gris-500">No hay usuarios con este filtro.</p>
            )}

            <div className="flex flex-col gap-[12px]">
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
                    // Ancla estable para los tests (T26-161). Esta pantalla no la tenía, y esa
                    // es parte de la razón por la que llegó sin cobertura e2e: sin un testid
                    // por fila, ubicar la tarjeta de un usuario obliga a filtrar divs por
                    // texto, que engancha el nodo más interno y no la tarjeta.
                    data-testid={`usuario-fila-${usuario.id}`}
                    style={{
                      backgroundColor: "var(--color-blanco)",
                      border: "1px solid var(--color-gris-150)",
                      borderRadius: 8,
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      opacity: usuario.activo ? 1 : 0.6,
                    }}
                  >
                    <div
                      className="flex justify-between items-center flex-wrap gap-[12px]"
                    >
                      <div>
                        <div className="text-[14px] font-bold text-gris-900 flex items-center gap-[6px]">
                          {usuario.nombre}
                          {esUnoMismo && (
                            <span className="text-[11px] font-medium text-slate-400">(vos)</span>
                          )}
                          {usuario.es_cuenta_servicio && (
                            <span
                              title="Cuenta de servicio del módulo de visión: si se desactiva, la detección se detiene."
                              className="flex items-center gap-[4px] text-[11px] font-semibold text-aviso"
                            >
                              <ShieldAlert size={13} />
                              cuenta de servicio
                            </span>
                          )}
                          {!usuario.activo && (
                            <span className="text-[11px] font-semibold text-error">· inactivo</span>
                          )}
                        </div>
                        <div className="text-[12px] text-gris-400">{usuario.email}</div>
                      </div>

                      <div className="flex gap-[8px] flex-wrap items-center">
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

                        <Boton
                          onClick={() => handleToggleActivo(usuario)}
                          variante={usuario.activo ? "peligro" : "secundario"}
                          disabled={usuario.activo && bloquearDesactivar}
                          cargando={guardando[usuario.id]}
                          textoCargando="Guardando..."
                        >
                          {usuario.activo ? "Desactivar" : "Reactivar"}
                        </Boton>
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

      {usuarioAConfirmar && (
        <ModalConfirmacion
          titulo={usuarioAConfirmar.activo ? "Desactivar usuario" : "Reactivar usuario"}
          mensaje={`¿${usuarioAConfirmar.activo ? "Desactivar" : "Reactivar"} a "${usuarioAConfirmar.nombre}"?`}
          etiquetaConfirmar={usuarioAConfirmar.activo ? "Desactivar" : "Reactivar"}
          // Reactivar no destruye nada: el rojo se reserva para el sentido que sí.
          peligroso={usuarioAConfirmar.activo}
          onConfirmar={() => confirmarToggleActivo(usuarioAConfirmar)}
          onCancelar={() => setUsuarioAConfirmar(null)}
        />
      )}
    </Layout>
  )
}
