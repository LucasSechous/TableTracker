# Roles y permisos por endpoint (RF-02 / T26-116)

Auditoría del estado real de la restricción por rol en los endpoints protegidos del backend,
y matriz resultante endpoint por endpoint. Antes de este ticket, `get_usuario_actual` solo
validaba que el token fuera válido — cualquier rol autenticado podía usar cualquier endpoint,
incluyendo alta de usuarios y borrado de mesas/sectores.

## Cómo funciona la restricción

`requiere_rol(*roles)` ([backend/app/routers/auth.py](../backend/app/routers/auth.py)) es una
dependencia adicional sobre `get_usuario_actual`: exige que el usuario autenticado tenga uno de
los roles indicados. **El rol `admin` siempre pasa**, sin necesidad de nombrarlo explícitamente
en cada endpoint — es el único rol con acceso total, análogo al "administrador" del anteproyecto.
Si el rol no está autorizado, devuelve **403** (no 401: el token ya es válido, lo que falta es
autorización).

Los valores de rol usados en código son sin tilde y en minúscula: `admin`, `encargado`, `mozo`,
`recepcion`, `limpieza`. No hay un `enum`/constraint que valide `User.rol` contra esta lista (es
un `String` libre) — ver "Fuera de alcance" más abajo.

## Matriz de acceso

| Método | Ruta | Rol(es) permitidos | Antes de este ticket |
|---|---|---|---|
| POST | `/auth/register` | `admin` | Cualquiera (sin token) |
| POST | `/auth/login` | Público (no requiere rol) | Sin cambios |
| GET | `/auth/me` | Cualquier rol autenticado | Sin cambios |
| GET | `/sectores/`, `/sectores/{id}` | Cualquier rol autenticado | Sin cambios |
| POST | `/sectores/` | `admin`, `encargado` | Cualquier rol autenticado |
| PATCH | `/sectores/{id}` | `admin`, `encargado` | Cualquier rol autenticado |
| DELETE | `/sectores/{id}` | `admin` | Cualquier rol autenticado |
| GET | `/mesas/`, `/mesas/{id}` | Cualquier rol autenticado | Sin cambios |
| POST | `/mesas/` | `admin`, `encargado` | Cualquier rol autenticado |
| PATCH | `/mesas/{id}` | `admin`, `encargado` | Cualquier rol autenticado |
| PATCH | `/mesas/{id}/estado` | `admin`, `encargado`, `mozo` | Cualquier rol autenticado |
| PATCH | `/mesas/{id}/limpieza` | `admin`, `encargado`, `limpieza` | Cualquier rol autenticado |
| PATCH | `/mesas/{id}/reserva` | `admin`, `encargado`, `recepcion` | Cualquier rol autenticado |
| PATCH | `/mesas/{id}/posicion` | `admin`, `encargado` | Cualquier rol autenticado |
| DELETE | `/mesas/{id}` | `admin` | Cualquier rol autenticado |
| GET | `/historial/` | Cualquier rol autenticado | Sin cambios |
| GET | `/metricas/ocupacion` | Cualquier rol autenticado | No existía (RF-22) |
| GET | `/metricas/rotacion` | Cualquier rol autenticado | No existía (RF-23) |
| GET | `/estados/` | Cualquier rol autenticado | No existía (RF-29) |
| GET | `/camaras/` | `admin`, `vision_module` | No existía (RF-30, RF-31) |
| POST | `/camaras/{id}/deteccion-actual` | `admin`, `vision_module` | No existía (T26-150) |
| * | resto de `/camaras/*` | `admin` | No existía (RF-30, RF-31) |
| GET | `/roi-mesa/` | `admin`, `vision_module` | No existía (RF-12) |
| * | resto de `/roi-mesa/*` | `admin` | No existía (RF-12) |
| GET | `/usuarios/` | `admin` | No existía (T26-175) |
| PATCH | `/usuarios/{id}` | `admin` | No existía (T26-175) |

## Criterios usados donde el ticket no daba un ejemplo directo

El ticket da tres ejemplos explícitos ("alta de usuarios solo admin", "cambio de estado
mozo/encargado", "configuración de cámaras solo admin"). Para el resto se usó este criterio,
confirmado con el reporter del ticket ante la falta de acceso al Capítulo 1 (anteproyecto):

- **Alta/edición/borrado de sectores y mesas, y reposicionamiento en el layout**: se trata como
  "configuración" del salón → `admin` + `encargado` (el encargado gestiona el salón día a día;
  el borrado —hoy baja lógica, ver más abajo— queda reservado a `admin` por ser la operación
  más drástica de cada recurso, aunque sea reversible).
- **`/mesas/{id}/limpieza`**: rol `limpieza` (el motivo de ser del rol) + `encargado`.
- **`/mesas/{id}/reserva`**: rol `recepcion` (el motivo de ser del rol) + `encargado`.
- **`GET /historial/`**: no es gestión de usuarios ni configuración (los dos ejemplos que da el
  criterio de aceptación para exigir 403), así que queda abierto a cualquier rol autenticado.
- **Borrados (`DELETE`)**: solo `admin` en todos los casos. Desde T26-199, `DELETE` es **baja
  lógica en los cuatro recursos** (sectores, mesas, cámaras y ROI) — antes `DELETE /sectores/{id}`
  y `DELETE /mesas/{id}` borraban físico, la única inconsistencia de contrato que quedaba entre
  recursos "papelera". Ver [camaras-roi.md](camaras-roi.md#endpoints) para el detalle de baja
  lógica + reactivación, que ahora aplica igual a los cuatro.
- **Cámaras y ROI**: `admin` en **todos** los verbos, incluidos los `GET`. El criterio de
  aceptación de T26-116 nombra "configuración de cámaras" como ejemplo explícito de acceso
  exclusivo de admin, y a diferencia de mesas y sectores acá el listado tampoco es inocuo: expone
  la topología de red del local (host, puerto y usuario de cada cámara). Ver
  [camaras-roi.md](camaras-roi.md).

  La única excepción es `vision_module` (T26-152), el usuario técnico del módulo de visión, y
  llega **exactamente** a los tres endpoints que el módulo consume: `GET /camaras/`,
  `POST /camaras/{id}/deteccion-actual` y `GET /roi-mesa/`. No es un rol de lectura general —
  `GET /camaras/{id}` y el snapshot le dan 403 igual que a cualquier otro rol.

  Ese recorte se aplica **por endpoint** y no en el `APIRouter` (T26-164). Ponerlo en el router
  alcanzaba para que el módulo funcionara, pero le daba también `POST`, `PATCH` y `DELETE` sobre
  cámaras y ROI: el router protege el archivo entero de una sola vez y no distingue verbos. Al
  agregar un endpoint nuevo a esos dos archivos hay que declararle su `dependencies=`, porque el
  router ya solo exige estar autenticado.

## Bootstrap del primer admin

`POST /auth/register` ahora exige rol `admin`, así que ya no hay forma de crear el primer
usuario del sistema a través de la API (decisión explícita: sin excepción de bootstrap). El
primer admin se crea con un script aparte:

```bash
cd backend
ADMIN_EMAIL=admin@tabletracker.com ADMIN_PASSWORD=... python -m app.seed_admin
```

Ver [backend/app/seed_admin.py](../backend/app/seed_admin.py). Es idempotente (no hace nada si
el email ya existe). Esto también rompía el autoregistro del usuario fijo de e2e — ver
[e2e/README.md](../e2e/README.md) para el nuevo paso de bootstrap requerido antes de correr la
suite.

## Gateo de la UI por rol

El backend es el que decide: responde 403 mire lo que mire la interfaz, y nada de lo de acá
abajo lo reemplaza. Lo que hace el frontend es no ofrecer un control que va a fallar.

Dos piezas, las dos nuevas respecto de la primera versión de este documento:

- **`frontend/src/hooks/useAuth.tsx`** — `AuthProvider` resuelve `GET /auth/me` **una sola vez**
  para todo el árbol y expone `{ user, rol, loading }` vía `useAuth()`. Antes cada consumidor lo
  pedía por su cuenta: `AdminRoute` uno y `DashboardPage` otro, así que entrar al salón y de ahí
  a `/camaras` disparaba dos llamadas idénticas. El provider va dentro de `<BrowserRouter>` y no
  llama a `/auth/me` si no hay token — con sesión cerrada el 401 dispararía la redirección a
  `/login` del interceptor de axios, que remonta y vuelve a pedir: un bucle de recargas.
- **`frontend/src/permisos.ts`** — funciones puras que replican el `requiere_rol(...)` del
  endpoint que cada control termina llamando: `esAdmin`, `esEncargado`, `puedeEditarLayout`
  (admin + encargado) y `puedeBorrar` (solo admin). Sin enum de roles a propósito: `User.rol` es
  un `String` libre y declarar un enum del lado del frontend inventaría una fuente de verdad que
  del otro lado no existe.

### Qué ve cada rol en el salón

| Control | Endpoint que dispara | Helper | admin | encargado | resto |
|---|---|---|---|---|---|
| Botón "Editar disposición" | — (entra al modo) | `puedeEditarLayout` | ✓ | ✓ | — |
| "+ Nuevo sector" / "+ Nueva mesa" | `POST /sectores/`, `POST /mesas/` | `puedeEditarLayout` | ✓ | ✓ | — |
| Arrastrar mesa | `PATCH /mesas/{id}/posicion` | `puedeEditarLayout` | ✓ | ✓ | — |
| Arrastrar / redimensionar sector | `PATCH /sectores/{id}` | `puedeEditarLayout` | ✓ | ✓ | — |
| Editar sector (lápiz) | `PATCH /sectores/{id}` | `puedeEditarLayout` | ✓ | ✓ | — |
| **Borrar sector (papelera)** | `DELETE /sectores/{id}` | `puedeBorrar` | ✓ | — | — |
| **Borrar mesa (papelera)** | `DELETE /mesas/{id}` | `puedeBorrar` | ✓ | — | — |
| Redimensionar el salón | `PATCH /configuracion` | `esAdmin` | ✓ | — | — |
| "Salir de edición" | — | *sin gate* | ✓ | ✓ | ✓ |

"Papelera" es literal desde T26-199: borrar un sector o una mesa es baja lógica (`activo`/`activa`
en `false`), no destrucción de la fila — igual que ya era para cámaras y ROI. Recrear un sector o
una mesa con el mismo nombre/número reactiva la fila dada de baja en vez de chocar contra su
UNIQUE, mismo criterio que `roi_mesa` (ver [camaras-roi.md](camaras-roi.md)). La columna "Endpoint
que dispara" es la del contrato (lo que `puedeBorrar` gatea); los dos controles de esta tabla en
realidad ejecutan la baja a través del `PATCH` genérico del recurso — ver F-11 en
[auditoria-codigo.md](auditoria-codigo.md), que sigue sin resolver.

### Qué ve cada rol en el panel de mesa

Los controles de escritura del `PanelMesa` (T26-195) siguen la misma idea pero con permisos
**cruzados**: ningún rol operativo los tiene todos, y cada uno tiene el que justifica su
existencia. Por eso son tres helpers y no uno solo.

| Control | Endpoint que dispara | Helper | admin | encargado | mozo | recepcion | limpieza |
|---|---|---|---|---|---|---|---|
| "Confirmar limpieza" | `PATCH /mesas/{id}/limpieza` | `puedeConfirmarLimpieza` | ✓ | ✓ | — | — | ✓ |
| "Marcar como reservada" | `PATCH /mesas/{id}/reserva` | `puedeReservar` | ✓ | ✓ | — | ✓ | — |
| Los 4 botones de estado | `PATCH /mesas/{id}/estado` | `puedeCambiarEstado` | ✓ | ✓ | ✓ | — | — |

El desplegable "Corregir estado manualmente" contiene los dos últimos, así que se muestra si
el rol puede **al menos uno**. Para `limpieza`, que no puede ninguno, se esconde entero: si
se mostrara, abriría una caja vacía. Cubierto por `e2e/tests/18-permisos-panel-mesa.spec.ts`.

`vision_module` queda fuera de `puedeCambiarEstado` aunque el backend lo acepte en
`PATCH /mesas/{id}/estado`: es el usuario técnico del módulo de visión, no alguien que abra
esta pantalla.

Dos criterios que no son obvios y conviene no revertir sin pensarlo:

- **Editar el layout NO es admin-only.** `POST`/`PATCH` de mesas y sectores piden `encargado`
  (admin pasa implícito), así que gatear esto con `esAdmin` dejaría al encargado sin la tarea
  que el backend le autoriza. Borrar sí es admin-only, y por eso las papeleras llevan un helper
  más estricto que el lápiz que tienen al lado.
- **No alcanza con esconder el botón.** El arrastre de mesas y sectores nace de un `mousedown`
  sobre el elemento, no de un control que se pueda ocultar. Por eso `SectorBloque` y `MesaVisual`
  cortan también en el handler (`if (modo !== "edicion" || !puedeEditar) return`): sin eso, un
  rol sin permiso arrastraría igual y se comería el 403 al soltar, con la posición ya movida en
  pantalla. Cubierto por `e2e/tests/17-permisos-layout.spec.ts`.

`SectorBloque` y `MesaVisual` leen el rol con `useAuth()` directo, sin recibirlo por props:
bajarlo desde `DashboardPage` obligaba a `SalonCanvas` a reenviar dos booleanos que no usa.

## Fuera de alcance (hallazgos, no corregidos en este ticket)

- ~~**Frontend sin gating por rol**~~ — **resuelto**. Cuando se escribió este documento,
  `DashboardPage` mostraba "Editar disposición" a cualquier usuario logueado y el `mozo` se
  enteraba del 403 recién al soltar la mesa. Ya no: ver "Gateo de la UI por rol" más abajo.
- **`User.rol` sin validación**: es un `String` libre, sin `enum` ni `CHECK` en la base. Un typo
  al crear un usuario (`"admim"`) no falla en el alta — el usuario queda autenticado pero sin
  poder pasar ningún `requiere_rol(...)`, y el error solo aparece como 403 al primer intento de
  uso, no como un mensaje claro al crearlo.
- ~~**No hay endpoint para gestión de usuarios más allá del alta**~~ Lo resolvió T26-175:
  `GET /usuarios/` y `PATCH /usuarios/{id}` (rol y baja lógica vía `activo`), los dos
  `admin`-only. El Capítulo 2 (bitácora de desarrollo) documenta `PUT /auth/users/{id}` y
  `PATCH /auth/users/{id}/deactivate` como si existieran desde antes y RF-02/RF-03 como "✓
  Completado" — esos dos paths puntuales siguen sin existir (la ruta real quedó bajo
  `/usuarios/`, no `/auth/users/`), así que la documentación de la tesis todavía necesita la
  corrección aparte que este párrafo ya pedía.
- **RLS de Supabase, CORS, bug del interceptor Axios**: mencionados en el epic T26-113 pero
  cubiertos por otros tickets, no por este.
