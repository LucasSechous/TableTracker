// Modal de alta de un usuario (RF-03).
//
// Cierra el último hueco de RF-03: hasta acá un admin podía listar, renombrar, cambiar el
// rol y dar de baja desde la pantalla, pero el ALTA solo existía como POST /auth/register,
// o sea por API. Crear al primer compañero de trabajo obligaba a abrir Swagger.
//
// El overlay, la caja, el banner de error y los botones los pone <Modal> (T26-200/F-3);
// acá queda solo el formulario.
//
// Las validaciones de este archivo son las que evitan un viaje al backend que ya se sabe
// que va a fallar (un campo vacío). Todo lo demás —email mal formado, email repetido— lo
// dice el backend y se muestra tal cual con extraerDetalle, que es el mismo criterio que
// sigue el resto de los modales: la UI no reimplementa las reglas del servidor.

import { useState } from "react"
import { usuariosApi, extraerDetalle } from "../services/api"
import { ROLES_ASIGNABLES } from "../constants"
import Modal from "./Modal"

// Mismo default que UserCreate.rol en el backend: el rol más común y el menos
// peligroso de asignar por descuido.
const ROL_POR_DEFECTO = "mozo"

const estiloInput =
  "block w-full box-border mt-[4px] p-[8px] text-[14px] border border-gris-250 rounded-[6px]"

interface Props {
  onClose: () => void
  /** El alta fue bien. Quien lo abre recarga el listado; no se le pasa la fila creada. */
  onUsuarioCreado: () => void
}

export default function ModalAltaUsuario({ onClose, onUsuarioCreado }: Props) {
  const [nombre, setNombre] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rol, setRol] = useState<string>(ROL_POR_DEFECTO)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirmar() {
    const nombreLimpio = nombre.trim()
    const emailLimpio = email.trim()

    if (!nombreLimpio) {
      setError("El nombre es obligatorio")
      return
    }
    if (!emailLimpio) {
      setError("El email es obligatorio")
      return
    }
    // La password no se recorta: los espacios son caracteres válidos de una contraseña y
    // sacarlos guardaría una distinta de la que la persona escribió, que después no le
    // dejaría entrar. Solo se exige que no esté vacía.
    if (!password) {
      setError("La contraseña es obligatoria")
      return
    }

    setGuardando(true)
    setError(null)
    try {
      await usuariosApi.crear({
        nombre: nombreLimpio,
        email: emailLimpio,
        password,
        rol,
      })
      onUsuarioCreado()
    } catch (err) {
      setError(await extraerDetalle(err, "No se pudo crear el usuario"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Nuevo usuario"
      error={error}
      ocupado={guardando}
      etiquetaConfirmar={guardando ? "Creando..." : "Crear usuario"}
      onConfirmar={handleConfirmar}
      onCancelar={onClose}
    >
      <label className="block text-[13px] text-gris-600 mb-[12px]">
        Nombre
        <input
          type="text"
          data-testid="alta-usuario-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
          className={estiloInput}
        />
      </label>

      <label className="block text-[13px] text-gris-600 mb-[12px]">
        Email
        {/* type="email" por el teclado que abre en celular; la validación real es la de
            EmailStr en el backend, no la del navegador. */}
        <input
          type="email"
          data-testid="alta-usuario-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={estiloInput}
        />
      </label>

      <label className="block text-[13px] text-gris-600 mb-[12px]">
        Contraseña
        <input
          type="password"
          data-testid="alta-usuario-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={estiloInput}
        />
        <span className="block mt-[4px] text-[12px] text-gris-400">
          La va a necesitar para entrar. No se puede ver ni cambiar después desde esta
          pantalla.
        </span>
      </label>

      <label className="block text-[13px] text-gris-600 mb-[20px]">
        Rol
        <select
          data-testid="alta-usuario-rol"
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className={estiloInput}
        >
          {ROLES_ASIGNABLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
    </Modal>
  )
}
