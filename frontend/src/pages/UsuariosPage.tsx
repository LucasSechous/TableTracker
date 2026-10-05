// Pantalla de administración de usuarios (T26-175, RF-03): alta, listado, renombrado,
// cambio de rol y baja lógica. Estructura calcada de CamarasPage.tsx (header, banners de
// error/éxito, extraerDetalle). Acceso restringido a admin, igual que /usuarios en el
// backend (requiere_rol("admin")) — ver AdminRoute en App.tsx.
//
// El alta y el renombrado cierran RF-03. Antes esta pantalla sabía listar, cambiar rol y
// dar de baja, pero crear un usuario era POST /auth/register a mano y el nombre no se
// podía corregir desde ningún lado: un typo al cargar a alguien quedaba fijo en la base.
//
// Email y password NO se editan acá a propósito, y el motivo está en el docstring de
// UserAdminUpdate (backend): el email es el `sub` del JWT y la clave con la que el backend
// reconoce a la cuenta de servicio de vision-module, y rotar la password sin versionado de
// tokens dejaría la credencial vieja usable hasta que el JWT venza solo.
//
// Las salvaguardas (no admin auto-desactivarse, no dejar el sistema sin admin activo,
// no desactivar la cuenta de vision-module) las aplica el backend con 409: esta
// pantalla deshabilita en la UI lo que sabe de antemano que va a fallar (la fila
// propia, la cuenta de servicio), pero el mensaje de error real siempre viene del
// backend por si se cuela algo (ej. el último admin, que acá no se puede calcular
// sin otra request).

import { useEffect, useState } from "react"
import { Pencil, ShieldAlert } from "lucide-react"
import { usuariosApi, extraerDetalle } from "../services/api"
import type { UsuarioAdmin } from "../types"
import { useAuth } from "../hooks/useAuth"
import { ROLES_ASIGNABLES } from "../constants"
import Layout from "../components/Layout"
import Boton from "../components/ui/Boton"
import ModalAltaUsuario from "../components/ModalAltaUsuario"
import ModalConfirmacion from "../components/ModalConfirmacion"

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
  const [modalAltaAbierto, setModalAltaAbierto] = useState(false)
  // Id del usuario que se está renombrando, y el texto en curso. Uno solo a la vez: el
  // borrador es un string y no un mapa por id porque abrir un segundo renombrado cierra el
  // primero, igual que el botón "Editar" de CamarasPage abre un modal y no varios.
  const [renombrando, setRenombrando] = useState<number | null>(null)
  const [borradorNombre, setBorradorNombre] = useState("")

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

  /** Devuelve si el cambio se aplicó: el renombrado deja el editor abierto si falló. */
  async function aplicarCambio(
    usuario: UsuarioAdmin,
    datos: { nombre?: string; rol?: string; activo?: boolean }
  ): Promise<boolean> {
    setGuardando((prev) => ({ ...prev, [usuario.id]: true }))
    setErrorFila((prev) => ({ ...prev, [usuario.id]: null }))
    try {
      await usuariosApi.actualizar(usuario.id, datos)
      // Recarga en vez de pisar la fila en memoria: con incluirInactivos apagado (el
      // default), desactivar a alguien tiene que sacarlo de la lista, no dejarlo con
      // la marca "inactivo" puesta pero visible pese al filtro.
      await cargar(incluirInactivos)
      return true
    } catch (err) {
      const mensaje = await extraerDetalle(err, "No se pudo actualizar el usuario")
      setErrorFila((prev) => ({ ...prev, [usuario.id]: mensaje }))
      return false
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

  function handleRenombrarClick(usuario: UsuarioAdmin) {
    setRenombrando(usuario.id)
    setBorradorNombre(usuario.nombre)
    // Limpia un error anterior de esta fila: si el intento pasado falló, el mensaje viejo
    // al lado de un campo recién abierto se lee como si el nuevo ya hubiera fallado.
    setErrorFila((prev) => ({ ...prev, [usuario.id]: null }))
  }

  async function handleGuardarNombre(usuario: UsuarioAdmin) {
    const limpio = borradorNombre.trim()
    // Mismo criterio que el backend (min_length=1 sobre el nombre ya recortado), para no
    // gastar un viaje en un pedido que vuelve 422.
    if (!limpio) {
      setErrorFila((prev) => ({ ...prev, [usuario.id]: "El nombre no puede quedar vacío" }))
      return
    }
    if (limpio === usuario.nombre) {
      setRenombrando(null)
      return
    }
    // El editor se cierra solo si el PATCH anduvo: si falló, el texto escrito sigue en
    // pantalla para corregirlo, en vez de perderse y obligar a tipearlo de nuevo.
    if (await aplicarCambio(usuario, { nombre: limpio })) setRenombrando(null)
  }

  return (
    // "+ Nuevo usuario" va en el encabezado y no entre los controles de la lista, igual que
    // "+ Nueva cámara" en CamarasPage: es la acción principal de la pantalla.
    <Layout
      acciones={
        !cargandoInicial && !errorInicial ? (
          <Boton variante="primario" onClick={() => setModalAltaAbierto(true)}>
            + Nuevo usuario
          </Boton>
        ) : undefined
      }
    >
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
                        {renombrando === usuario.id ? (
                          // Renombrado en línea y no en un modal: es un solo campo, y el
                          // modal taparía el error de la fila que es justo donde el backend
                          // contesta. Enter guarda y Escape cancela, además de los botones.
                          <div className="flex items-center gap-[6px] flex-wrap">
                            <input
                              type="text"
                              data-testid={`usuario-nombre-input-${usuario.id}`}
                              value={borradorNombre}
                              onChange={(e) => setBorradorNombre(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleGuardarNombre(usuario)
                                if (e.key === "Escape") setRenombrando(null)
                              }}
                              autoFocus
                              className="p-[6px] text-[14px] font-bold border border-gris-250 rounded-[6px]"
                            />
                            <Boton
                              variante="primario"
                              onClick={() => handleGuardarNombre(usuario)}
                              cargando={guardando[usuario.id]}
                              textoCargando="Guardando..."
                            >
                              Guardar
                            </Boton>
                            <Boton onClick={() => setRenombrando(null)}>Cancelar</Boton>
                          </div>
                        ) : (
                          <div className="text-[14px] font-bold text-gris-900 flex items-center gap-[6px]">
                            {usuario.nombre}
                            {/* Renombrar no está restringido ni para la fila propia ni para la
                                cuenta de servicio, a diferencia del select de rol y del botón de
                                baja: el nombre no identifica ni autentica nada —el backend
                                reconoce a vision-module por su EMAIL— así que cambiarlo no puede
                                dejar a nadie afuera ni apagar una salvaguarda. */}
                            <button
                              type="button"
                              data-testid={`usuario-renombrar-${usuario.id}`}
                              title="Renombrar"
                              aria-label={`Renombrar a ${usuario.nombre}`}
                              onClick={() => handleRenombrarClick(usuario)}
                              className="flex items-center bg-transparent border-none p-[2px] cursor-pointer text-gris-400 hover:text-gris-900"
                            >
                              <Pencil size={13} />
                            </button>
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
                        )}
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
                          {!ROLES_ASIGNABLES.includes(
                            usuario.rol as (typeof ROLES_ASIGNABLES)[number]
                          ) && <option value={usuario.rol}>{usuario.rol}</option>}
                          {ROLES_ASIGNABLES.map((rol) => (
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

      {modalAltaAbierto && (
        <ModalAltaUsuario
          onClose={() => setModalAltaAbierto(false)}
          onUsuarioCreado={() => {
            setModalAltaAbierto(false)
            // Recarga en vez de insertar la fila que devolvió el register: ese endpoint
            // responde UserResponse, sin el `es_cuenta_servicio` que esta lista necesita, y
            // con el filtro de inactivos puesto el orden lo define el backend (por id).
            cargar(incluirInactivos)
          }}
        />
      )}

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
