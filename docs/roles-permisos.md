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
| * | `/camaras/*` | `admin` | No existía (RF-30, RF-31) |
| * | `/roi-mesa/*` | `admin` | No existía (RF-12) |

## Criterios usados donde el ticket no daba un ejemplo directo

El ticket da tres ejemplos explícitos ("alta de usuarios solo admin", "cambio de estado
mozo/encargado", "configuración de cámaras solo admin"). Para el resto se usó este criterio,
confirmado con el reporter del ticket ante la falta de acceso al Capítulo 1 (anteproyecto):

- **Alta/edición/borrado de sectores y mesas, y reposicionamiento en el layout**: se trata como
  "configuración" del salón → `admin` + `encargado` (el encargado gestiona el salón día a día;
  el borrado físico, al ser destructivo y sin soft-delete real hacia atrás en historial con
  vínculos, queda reservado a `admin`).
- **`/mesas/{id}/limpieza`**: rol `limpieza` (el motivo de ser del rol) + `encargado`.
- **`/mesas/{id}/reserva`**: rol `recepcion` (el motivo de ser del rol) + `encargado`.
- **`GET /historial/`**: no es gestión de usuarios ni configuración (los dos ejemplos que da el
  criterio de aceptación para exigir 403), así que queda abierto a cualquier rol autenticado.
- **Borrados (`DELETE`)**: solo `admin` en todos los casos, por ser la operación más destructiva
  de cada recurso.
- **Cámaras y ROI**: `admin` en **todos** los verbos, incluidos los `GET`. El criterio de
  aceptación de T26-116 nombra "configuración de cámaras" como ejemplo explícito de acceso
  exclusivo de admin, y a diferencia de mesas y sectores acá el listado tampoco es inocuo: expone
  la topología de red del local (host, puerto y usuario de cada cámara). Ver
  [camaras-roi.md](camaras-roi.md).

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

## Fuera de alcance (hallazgos, no corregidos en este ticket)

- **Frontend sin gating por rol**: `DashboardPage` muestra "Editar disposición" (crear/mover
  sectores y mesas) a cualquier usuario logueado, sin ocultar la acción a roles que el backend
  ahora rechaza con 403 (ej. un `mozo` ve el botón y recién al hacer la request recibe el error).
  No hay endpoint de gestión de usuarios en la UI hoy, así que este problema es exclusivo de la
  edición de layout.
- **`User.rol` sin validación**: es un `String` libre, sin `enum` ni `CHECK` en la base. Un typo
  al crear un usuario (`"admim"`) no falla en el alta — el usuario queda autenticado pero sin
  poder pasar ningún `requiere_rol(...)`, y el error solo aparece como 403 al primer intento de
  uso, no como un mensaje claro al crearlo.
- **No hay endpoint para gestión de usuarios más allá del alta**: no existe listado, edición de
  rol ni baja de usuarios. El Capítulo 2 (bitácora de desarrollo) documenta `PUT /auth/users/{id}`
  y `PATCH /auth/users/{id}/deactivate` como si existieran y RF-02/RF-03 como "✓ Completado" —
  ninguno de los dos endpoints está en el código actual. Vale la pena abrir un ticket aparte para
  esa gestión de usuarios y corregir la documentación de la tesis.
- **RLS de Supabase, CORS, bug del interceptor Axios**: mencionados en el epic T26-113 pero
  cubiertos por otros tickets, no por este.
