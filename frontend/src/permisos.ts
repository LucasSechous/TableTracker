// Quién puede hacer qué, del lado del frontend.
//
// Estas funciones NO son un control de acceso: el que manda es el backend, que responde
// 403 sin mirar lo que la UI haya decidido (docs/roles-permisos.md). Lo que hacen es
// evitar que alguien vea un control que va a fallar — un mozo tocando "Editar
// disposición" recibía el error recién al soltar la mesa, con el drag ya hecho.
//
// Por eso cada función replica EXACTAMENTE el requiere_rol(...) del endpoint que el
// control termina llamando, y no un criterio propio. Si el backend cambia, esto tiene que
// cambiar con él; el comentario de cada función dice contra qué endpoint se corresponde.
//
// Deliberadamente sin enum de roles: `User.rol` es un String libre en la base, sin enum ni
// CHECK, y los roles viven como strings sueltos en cada requiere_rol(...) del backend
// (backend/app/routers/). Declarar un enum acá inventaría una fuente de verdad que del
// otro lado no existe, y el primer rol nuevo que alguien agregue en el backend dejaría al
// frontend rechazándolo sin motivo.
//
// El `rol` llega opcional porque mientras useAuth() está cargando todavía no se sabe cuál
// es: en ese estado todas devuelven false, así que un control aparece recién cuando se
// confirmó que corresponde, y nunca parpadea visible-y-después-oculto.

const ADMIN = "admin"
const ENCARGADO = "encargado"
const MOZO = "mozo"
const RECEPCION = "recepcion"
const LIMPIEZA = "limpieza"

/** Rol con acceso total. En el backend `requiere_rol(...)` lo deja pasar siempre, sin nombrarlo. */
export function esAdmin(rol?: string): boolean {
  return rol === ADMIN
}

/** Encargado estricto: NO incluye admin. Para preguntar "¿puede X?" usar las de abajo. */
export function esEncargado(rol?: string): boolean {
  return rol === ENCARGADO
}

/**
 * Mover, redimensionar, crear y editar mesas y sectores.
 *
 * Corresponde a `requiere_rol("encargado")` en POST/PATCH `/mesas/`, `PATCH
 * /mesas/{id}/posicion` y POST/PATCH `/sectores/` — donde admin pasa implícitamente.
 * Es a propósito más amplio que esAdmin: el encargado gestiona el salón día a día y el
 * backend lo autoriza, así que gatear esto con "solo admin" lo dejaría afuera de su
 * propia tarea.
 */
export function puedeEditarLayout(rol?: string): boolean {
  return esAdmin(rol) || esEncargado(rol)
}

/**
 * Borrar mesas y sectores.
 *
 * Corresponde a `requiere_rol(ROL_ADMIN)` en DELETE `/mesas/{id}` y DELETE
 * `/sectores/{id}`. Más restrictivo que puedeEditarLayout aunque los dos controles vivan
 * juntos en el modo edición: el borrado es la operación destructiva de cada recurso y el
 * backend la reserva a admin.
 */
export function puedeBorrar(rol?: string): boolean {
  return esAdmin(rol)
}
// --- Acciones sobre una mesa desde el panel de monitoreo (T26-195) -----------
//
// A diferencia del modo edición, acá los tres permisos son *cruzados*: ningún rol
// operativo los tiene todos, y cada uno tiene exactamente el que justifica su existencia.
// Un mozo cambia estados pero no confirma limpieza; limpieza confirma limpieza pero no
// toca estados; recepción reserva y nada más. Por eso son tres funciones y no una sola
// "puedeOperarMesa": colapsarlas dejaría a alguien viendo un botón que le da 403.

/**
 * Confirmar que una mesa pendiente ya está limpia.
 *
 * Corresponde a `requiere_rol("encargado", "limpieza")` en `PATCH /mesas/{id}/limpieza`.
 */
export function puedeConfirmarLimpieza(rol?: string): boolean {
  return esAdmin(rol) || rol === ENCARGADO || rol === LIMPIEZA
}

/**
 * Marcar una mesa como reservada.
 *
 * Corresponde a `requiere_rol("encargado", "recepcion")` en `PATCH /mesas/{id}/reserva`.
 */
export function puedeReservar(rol?: string): boolean {
  return esAdmin(rol) || rol === ENCARGADO || rol === RECEPCION
}

/**
 * Corregir a mano el estado de una mesa (RF-17).
 *
 * Corresponde a `requiere_rol("encargado", "mozo", ROL_VISION_MODULE)` en
 * `PATCH /mesas/{id}/estado`. `vision_module` queda afuera a propósito: es el usuario
 * técnico del módulo de visión, no alguien que abra esta pantalla.
 */
export function puedeCambiarEstado(rol?: string): boolean {
  return esAdmin(rol) || rol === ENCARGADO || rol === MOZO
}
