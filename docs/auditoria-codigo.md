# Auditoría de código — T26-133

**Fecha:** 2026-09-10
**Alcance:** backend (routers, models, schemas), frontend (pages, componentes, capa de API, `permisos.ts`, `hooks/useAuth.tsx`) e integración entre ambos.
**Tipo:** relevamiento. No se modificó código de producción, no se aplicaron fixes, no se corrieron migraciones.

## Fuera de alcance

- **`vision-module/`** — está en medio de la corrección de T26-197; cualquier hallazgo quedaría desactualizado. Solo se leyó `app/client/backend_client.py`, de lectura, para saber qué endpoints del backend consume y no marcarlos mal como huérfanos. Ver la última sección para lo que quedó anotado.
- **Gating por rol, `User.rol` y endpoints de gestión de usuarios** — cubiertos por T26-190, T26-194, T26-195 y la auditoría de integridad de septiembre. Donde un hallazgo de *consistencia de código* roza el gating, se señala y se remite a ese trabajo en vez de re-evaluarlo.

## Método

Cruce automatizado (inventario de endpoints contra el OpenAPI del backend en ejecución, y de exports contra sus consumidores reales), verificado a mano hallazgo por hallazgo. Los recuentos de este informe salen de esas consultas, no de una lectura a ojo.

Un primer barrido de "funciones muertas" en el backend devolvió los 37 handlers de FastAPI: se despachan por decorador y nunca se invocan por nombre. **El resultado se descartó por falso positivo**, no se reporta.

---

# 1. Backend

## 1.1 Lógica duplicada o superpuesta

### B-1 · El patrón "buscar o 404" está escrito inline, router por router

`mesas.py` repite la misma consulta y el mismo `raise` en siete handlers: líneas **70, 107, 144, 161, 180, 198, 215**. `sectores.py` hace lo mismo en **23, 51, 67**.

```python
mesa = db.query(Mesa).options(joinedload(Mesa.sector)).filter(Mesa.id == mesa_id).first()
if not mesa:
    raise HTTPException(status_code=404, detail="Mesa no encontrada")
```

`camaras.py:60`, `roi.py:32` y `configuracion.py:12` ya resolvieron esto con un `_obtener()` privado. Son dos convenciones conviviendo en el mismo directorio.

**Recomendación:** extraer `_obtener()` en `mesas.py` y `sectores.py`, siguiendo la forma que ya tienen los otros tres routers. Es refactor mecánico y la suite de 252 tests lo cubre.

### B-2 · La validación "el sector indicado no existe" está repetida cinco veces

`mesas.py:87` y `:111`, `camaras.py:69`, `metricas.py:41` y `:109`. Mismo `SELECT`, mismo status 400, mismo texto. `camaras.py` la encapsuló en `_validar_sector()`; los otros dos la escriben a mano.

**Recomendación:** mover `_validar_sector()` a un módulo compartido (`app/services/` o un `routers/_comun.py`) y usarlo en los tres. Hoy, cambiar el mensaje obliga a tocar tres archivos.

### B-3 · Dos endpoints de prueba de conexión con caminos paralelos

`camaras.py:208` (`POST /camaras/{id}/test-conexion`, prueba una cámara guardada) y `camaras.py:237` (`POST /camaras/test-conexion`, prueba una URL suelta). **No son redundantes** —resuelven momentos distintos, antes y después de guardar— pero comparten armado de respuesta y validación, y el segundo no tiene consumidor (ver B-4).

**Recomendación:** no unificarlos. Decidir si el segundo se cablea en el modal de alta o se elimina; mientras tanto queda código mantenido sin uso.

## 1.2 Código muerto / no usado

Los endpoints siguientes existen y funcionan, pero **ningún cliente los llama** — ni el frontend ni vision-module. (Uno de ellos, `GET /estados/`, quedó en esta lista por error: ver la corrección más abajo.)

| Endpoint | Situación | Recomendación |
|---|---|---|
| `POST /camaras/test-conexion` | `camaras.py:237`. Probar una URL antes de guardarla; ni `ModalAltaCamara` ni `ModalEditarCamara` lo usan. | Cablearlo en el modal (es la UX que justifica su existencia) o darlo de baja. |
| `POST /auth/register` | El alta de usuarios no existe en la UI: `UsuariosPage` solo lista y modifica. | Confirmar si el alta es alcance pendiente; si no, el endpoint queda sin puerta de entrada. |
| ~~`GET /estados/`~~ | **Listado por error**: sí tiene consumidor, `ConfiguracionPage.tsx:153` (ver la corrección en F-8 e I-3). | Se queda. Convivencia documentada en I-3. |
| `GET /sectores/{id}` · `GET /roi-mesa/{id}` | El frontend siempre trae la colección completa y filtra en memoria. | Dejarlos (son CRUD de contrato) pero anotar que no están ejercitados por ningún consumidor. |

`GET /mesas/{id}` y `POST /camaras/{id}/deteccion-actual` **no** son huérfanos: los consume vision-module.

**Schemas: limpios.** De 33 clases en `app/schemas/`, ninguna quedó sin uso. Las dos que aparecían aisladas (`Detection`, `DetectionBox` en `deteccion.py`) están anidadas dentro de `DetectionFrameResult`, que sí se usa.

## 1.3 Inconsistencias de patrón

### B-4 · `DELETE` significa dos cosas distintas según el recurso

| Endpoint | Qué hace | Handler |
|---|---|---|
| `DELETE /camaras/{id}` | baja lógica (`activa = False`) | `desactivar_camara` |
| `DELETE /roi-mesa/{id}` | baja lógica (`activa = False`) | `desactivar_roi` |
| `DELETE /mesas/{id}` | **borrado físico** (`db.delete`) | `eliminar_mesa` |
| `DELETE /sectores/{id}` | **borrado físico** (`db.delete`) | `eliminar_sector` |

Los nombres de función son honestos con lo que cada uno hace; el problema es que el verbo HTTP no distingue, y un cliente que asuma "DELETE = baja lógica" por haber visto cámaras pierde datos al usarlo en mesas. El frontend, de hecho, **evita los dos destructivos** y usa `PATCH activa/activo:false` en su lugar (ver F-7 e I-2).

**Recomendación:** unificar la semántica. La convención mayoritaria del proyecto —y la que el frontend ya usa de hecho— es la baja lógica; pasar mesas y sectores a ese esquema dejaría `DELETE` con un solo significado. Es un cambio de contrato: merece su propio ticket.

### B-5 · El rol exigido cambia entre `PATCH` y `DELETE` del mismo recurso

`PATCH /mesas/{id}` y `PATCH /sectores/{id}` piden `requiere_rol("encargado")`; los `DELETE` equivalentes piden `ROL_ADMIN`. Como el frontend borra vía `PATCH`, el control queda gateado por un endpoint y ejecutado por otro (ver F-7).

**Se reporta como observación, no como hallazgo evaluado**: decidir qué rol corresponde es gating, fuera del alcance de esta pasada. Queda para el trabajo que ya cubre T26-190/194/195.

---

# 2. Frontend

## 2.1 Lógica duplicada o superpuesta

### F-1 · `UsuariosPage` reintrodujo la llamada que `useAuth` vino a eliminar

`pages/UsuariosPage.tsx:72`:

```tsx
authApi.me().then((res) => setMiId(res.data.id)).catch(() => {})
```

`useAuth()` ya expone `user` —con `id`— resuelto una sola vez para todo el árbol. Esta página no lo consume: mantiene su propio estado `miId`, su propio efecto y su propia request. Es exactamente el patrón que `hooks/useAuth.tsx` documenta haber eliminado de `AdminRoute` y `DashboardPage`.

**Recomendación:** reemplazar por `const { user } = useAuth()` y borrar el estado y el efecto. Elimina un `GET /auth/me` por visita.

### F-2 · `horario.ts` espeja `horario.py`, y la copia usa otro huso

`frontend/src/horario.ts:28` reimplementa `en_horario_de_servicio()` del backend, incluido el cruce de medianoche. El archivo documenta la decisión y la justifica (responden preguntas distintas), así que **no es duplicación por descuido**. Pero hay dos cosas que cambiaron desde que se escribió:

1. **El backend ganó un tercer consumidor de la misma regla**: RF-27 (T26-188) la usa en `services/estado_dudoso.py` para decidir si una mesa es dudosa. Ahora la regla vive en un lugar del frontend y dos del backend.
2. **Los husos no coinciden.** El backend evalúa contra `TZ_LOCAL` (`America/Montevideo`); `horario.ts:40` usa `momento.getHours()`, o sea el reloj del navegador. El propio archivo lo anticipa ("un navegador en otro huso vería el aviso corrido"), pero con RF-27 la consecuencia es nueva y visible: el dashboard puede marcar una mesa como dudosa —calculado con `TZ_LOCAL`— mientras `OcupacionPage` dice que el local está abierto, calculado con el huso del navegador.

**Recomendación:** que el backend exponga "¿está abierto ahora?" como dato (por ejemplo junto a la configuración, o en la respuesta de ocupación) y que el frontend lo consuma en vez de recalcularlo. Elimina la copia y el desfase de huso de una sola vez.

### F-3 · Los cinco modales repiten el mismo overlay

`ModalAltaCamara`, `ModalAltaMesa`, `ModalAltaSector`, `ModalEditarCamara` y `ModalEditarSector` declaran cada uno el bloque idéntico (ej. `ModalAltaSector.tsx:44` y `ModalAltaMesa.tsx:77`):

```tsx
position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
```

**Recomendación:** extraer un `<Modal>` con el overlay, la caja y el cierre, y dejar en cada archivo solo el formulario. Cinco copias es donde un cambio de z-index o de accesibilidad se aplica mal en una.

### F-4 · El ciclo de arrastre está reimplementado en tres componentes

`MesaVisual.tsx`, `SectorBloque.tsx` y `SalonCanvas.tsx` montan cada uno su `useEffect` con `mousemove`/`mouseup` sobre `window`, sus refs `isDragging`/`dragStart` y su limpieza de listeners. Las tres variantes difieren solo en qué se clampea.

**Recomendación:** extraer un hook `useArrastre({ onMover, onSoltar, clamp })`. Es la lógica con más aristas del canvas (listeners globales, limpieza, estado optimista) y hoy hay que corregirla en tres lugares.

### F-5 · Tres permisos con el mismo cuerpo copiado

`permisos.ts:76`, `:85` y `:96` son la misma forma con distintos literales:

```ts
return esAdmin(rol) || rol === ENCARGADO || rol === LIMPIEZA   // puedeConfirmarLimpieza
return esAdmin(rol) || rol === ENCARGADO || rol === RECEPCION  // puedeReservar
return esAdmin(rol) || rol === ENCARGADO || rol === MOZO       // puedeCambiarEstado
```

El backend expresa exactamente esto con **una** función variádica, `requiere_rol(*roles_permitidos)` (`auth.py:116`), que además concentra el bypass de admin en un solo lugar.

**Recomendación:** un `tieneRol(rol, ...roles)` privado que replique la forma del backend, y dejar cada permiso como una línea declarativa. Hoy, sumar un rol al bypass exige editar tres cuerpos y un typo en uno es invisible.

### F-6 · Dos helpers para extraer el detalle de un error

`extraerDetalle` (`api.ts:356`, síncrono, 17 usos) y `extraerDetalleApi` (`api.ts:365`, asíncrono, 18 usos). Comparten el núcleo `detalleDesdeCuerpo`; el asíncrono es un **superset** que además maneja el cuerpo `Blob` de `camarasApi.snapshot`.

El problema es el nombre: `extraerDetalleApi` suena más general que `extraerDetalle` siendo el especializado, y su comentario dice que "sirve para cualquier error de la API". Con 35 llamadas repartidas casi mitad y mitad, la elección entre uno y otro parece azarosa.

**Recomendación:** dejar uno solo (el asíncrono cubre ambos casos) o renombrarlos a algo que diga la diferencia real (`extraerDetalle` / `extraerDetalleDeBlob`).

## 2.2 Código muerto / no usado

### F-7 · Exports sin ningún consumidor externo

| Export | Archivo | Situación |
|---|---|---|
| `esEncargado` | `permisos.ts:34` | Único uso: `puedeEditarLayout` en la línea 48, del mismo archivo. Su docstring dice *"Para preguntar «¿puede X?» usar las de abajo"*: está documentado como trampa y exportado igual. Un `esEncargado(rol)` en un call site excluiría a admin, a quien el backend siempre deja pasar. |
| `TAMANO_MINIMO_SALON` | `constants.ts` | Único uso: `calcularMinimoSalon`, mismo archivo. |
| `formatearNumeroCsv` | `csv.ts` | Único uso: dentro de `csv.ts`. |

**Recomendación:** los tres pasan a privados del módulo (quitar `export`). Ninguno se borra: los tres se usan internamente.

### F-8 · Métodos de `api.ts` que nadie llama · **CORREGIDO — dos de los cuatro estaban mal**

> **Error de este informe, detectado al aplicarlo (T26-200).** La lista original decía
> `historialApi.listar`, `sectoresApi.eliminar`, `camarasApi.obtener` y `estadosApi.listar`.
> **Dos de esos cuatro sí tienen consumidor.** La causa fue de método: el barrido buscaba
> `objeto\.metodo\(` en una sola línea, y el código llama encadenando en dos —
> `historialApi\n  .listar({ ... })` —, así que el grep no los encontró y los contó como
> muertos. Re-verificado con un patrón tolerante al salto de línea (`\bobj\s*\.\s*met\s*\(`).

Estado real:

| Método | Consumidor | Situación |
|---|---|---|
| `camarasApi.obtener` | ninguno | Muerto de verdad. **Eliminado** en T26-200. |
| `sectoresApi.eliminar` | ninguno | Muerto **porque el frontend eligió el otro camino**: `SectorBloque` borra con `sectoresApi.actualizar(id, { activo: false })`. Su baja depende de B-4; sigue en pie. |
| `historialApi.listar` | `PanelMesa.tsx:50` | **NO está muerto.** Trae la última transición de UNA mesa para calcular hace cuánto está en su estado. `listarTodo` no lo desplazó: resuelve otra cosa (el listado paginado de `HistorialPage`). |
| `estadosApi.listar` | `ConfiguracionPage.tsx:153` | **NO está muerto.** Ver I-3. |

**Recomendación (actualizada):** solo `camarasApi.obtener` era eliminable sin decidir nada, y
ya se eliminó. `sectoresApi.eliminar` espera a B-4. Los otros dos se quedan.

## 2.3 Inconsistencias de patrón

### F-9 · Dos formas de mostrar un error, y una pantalla que usa las dos

Conviven `alert()` nativo (9 sitios) y el banner in-page con `setError` (15 archivos). `DashboardPage` usa **las dos**: banner para el fallo de carga, `alert()` para los fallos de acción (líneas 194, 217, 232, 247, 258).

Los `alert()` están concentrados en el canvas y el panel de mesa —`MesaVisual.tsx:119`, `PanelMesa.tsx:79`, `SectorBloque.tsx:189`—, que es justo el flujo de uso continuo donde un diálogo modal del navegador interrumpe más.

**Recomendación:** unificar en el banner in-page, que además es testeable por `data-testid` (los `alert()` obligan a interceptar el diálogo en Playwright).

### F-10 · Confirmaciones con `window.confirm` teniendo modales propios

Cinco sitios (`MesaVisual.tsx:113`, `SectorBloque.tsx:183`, `CalibracionRoiPage.tsx:282`, `CamarasPage.tsx:137`, `UsuariosPage.tsx:117`) usan el diálogo nativo, mientras el proyecto mantiene cinco modales propios para altas y ediciones. Las acciones destructivas son las únicas con estética de navegador.

**Recomendación:** un `ModalConfirmacion` reutilizable, junto con el `<Modal>` de F-3.

### F-11 · `permisos.ts` rompe el invariante que declara en su propia cabecera

El encabezado del módulo (líneas 8-10) promete: *"cada función replica EXACTAMENTE el `requiere_rol(...)` del endpoint que el control termina llamando"*.

`puedeBorrar` (línea 59) documenta corresponder a `DELETE /mesas/{id}` y `DELETE /sectores/{id}`. Sus dos call sites llaman otra cosa:

- `MesaVisual.tsx:248` gatea con `puedeBorrar`, y `:116` ejecuta `mesasApi.desactivar` → `PATCH /mesas/{id}`
- `SectorBloque.tsx:253` gatea con `puedeBorrar`, y `:186` ejecuta `sectoresApi.actualizar` → `PATCH /sectores/{id}`

El frontend **nunca llama a los `DELETE`** que el docstring cita. El rol documentado es correcto para el endpoint citado, pero el endpoint citado no es el que se invoca.

**Recomendación:** actualizar el docstring al endpoint real, o cambiar los call sites a `DELETE` para que coincidan con lo documentado. **Cuál de las dos es la correcta depende de B-4 y B-5, que son gating y quedan fuera de esta pasada** — acá se reporta solo la contradicción entre el comentario y el código.

### F-12 · `SalonCanvas` recibe el rol por prop mientras sus hijos lo leen del contexto

`SalonCanvas.tsx:19` declara `esAdmin: boolean`, alimentado desde `DashboardPage.tsx:540`, y lo usa solo para `puedeRedimensionar`. Sus tres descendientes —`MesaVisual`, `SectorBloque`, `PanelMesa`— fueron convertidos a `useAuth()` precisamente para que el rol no viaje por props.

**Recomendación:** que `SalonCanvas` también lea `useAuth()` y eliminar la prop. Dos caminos para el mismo dato significa que un cambio en cómo se resuelve el rol hay que hacerlo dos veces, y la prop puede quedar desfasada del contexto del que se derivó.

---

# 3. Integración frontend ↔ backend

**Base del cruce:** 41 endpoints en el OpenAPI del backend contra 33 pares método+ruta declarados en `services/api.ts`.

**Dos resultados limpios, que conviene dejar asentados:**

- **No hay ninguna llamada del frontend a un endpoint inexistente.** Los 33 pares resuelven contra una ruta real.
- **Todo el HTTP pasa por `services/api.ts`.** Cero llamadas sueltas a `axios` en pages o componentes.

También se verificaron los endpoints que el frontend invoca sin cuerpo (`PATCH /mesas/{id}/limpieza`, `PATCH /mesas/{id}/reserva`, `POST /camaras/{id}/test-conexion`): los tres declaran `requestBody: ninguno` en el OpenAPI. El contrato coincide.

### I-1 · Dos `GET` sin barra final se comen un redirect 307 en cada llamada

| Línea | Llamada | Resultado |
|---|---|---|
| `api.ts:91` | `api.get<Mesa[]>("/mesas", { params })` | **307** → `/mesas/` |
| `api.ts:172` | `api.get<Sector[]>("/sectores")` | **307** → `/sectores/` |

El resto del archivo sí la pone (`/camaras/`, `/roi-mesa/`, `/historial/`, `/usuarios/`, `/estados/`, y el `POST /mesas/`). El comentario de `api.ts:93` —dos líneas debajo del primer caso— explica exactamente por qué importa: *"La barra final apunta al path exacto del router y evita el 307 de FastAPI"*. La corrección se aplicó en todo el archivo menos en estos dos `GET`.

Verificado contra el backend en ejecución: `/mesas`, `/sectores`, `/historial`, `/camaras`, `/roi-mesa`, `/estados` y `/usuarios` devuelven 307 sin la barra; `/configuracion` y `/metricas/ocupacion` devuelven 200 porque sus rutas no la llevan.

**Por qué no es cosmético:** `mesasApi.listar` es la llamada que `DashboardPage` repite **cada 3 segundos** en modo monitoreo. Es la ruta más caliente de la aplicación, y hoy son dos viajes en vez de uno.

**Recomendación:** agregar la barra en las dos líneas. Es el arreglo de menor riesgo y mayor efecto de todo este informe.

### I-2 · Endpoints sin consumidor

Detallados en 1.2. Resumen: `POST /camaras/test-conexion`, `POST /auth/register`, `GET /sectores/{id}`, `GET /roi-mesa/{id}`. Más `GET /` (raíz), que es un health check y no necesita consumidor.

`GET /estados/` figuraba acá y **se saca**: sí tiene consumidor (`ConfiguracionPage`), ver I-3.

Caso aparte, ya cubierto en B-4: `DELETE /mesas/{id}` y `DELETE /sectores/{id}` existen y el frontend los esquiva usando `PATCH`.

### I-3 · Las etiquetas de estado tienen dos fuentes de verdad · **RESUELTO como convivencia documentada**

`GET /estados/` (`routers/estados.py`, T26-157 / RF-29) devuelve el enum `EstadoMesa` resuelto a `{valor, etiqueta}`. Su cliente es `estadosApi.listar`.

> **Corrección.** La versión original de este hallazgo afirmaba que **nadie** llamaba a
> `estadosApi.listar`, y sobre esa base recomendaba dar de baja el endpoint. Es falso, por el
> mismo error de grep descrito en F-8: **`ConfiguracionPage.tsx:153` lo consume**, para el
> bloque informativo de solo lectura que le muestra al admin los estados que maneja el
> sistema. Ese bloque tiene su propio estado de error (`errorEstados`) y un comentario que
> explica que es informativo y no debe romper la pantalla si falla.

Las etiquetas que el usuario ve en el canvas salen del mapa `ETIQUETA_POR_ESTADO` (`constants.ts`), consumido por `PanelMesa`, `SalonCanvas`, `DashboardPage` e `HistorialPage`. El comentario de `constants.ts` —*"el endpoint es la fuente para pantallas que listan los estados como dato"*— resulta ser **exacto**: esa pantalla existe, es `ConfiguracionPage`.

**Decisión (T26-200):** se quedan los dos, y se documenta por qué.

No es una duplicación por descuido sino dos usos distintos del mismo dato: `ETIQUETA_POR_ESTADO` es el mapa con el que se PINTA un estado que ya se tiene (necesita ser síncrono: se usa en pleno render del canvas, que refresca cada 3s), y `GET /estados/` es la introspección de qué estados EXISTEN, que solo el backend sabe. Migrar `ConfiguracionPage` al mapa hardcodeado le sacaría el sentido a la sección: dejaría de reflejar el enum real del backend para volverse un eco estático del mismo mapa que ya se ve en todo el resto de la app.

El riesgo que este hallazgo señalaba —agregar un estado en el backend deja el mapa incompleto en silencio— sigue existiendo, pero es el precio de tener un mapa síncrono para el render, no algo que se arregle dando de baja el endpoint.

---

# 4. Resumen priorizado

| # | Hallazgo | Módulo | Tipo | Esfuerzo |
|---|---|---|---|---|
| ~~I-1~~ | ~~Dos `GET` sin barra final → 307 en la ruta más caliente~~ · **RESUELTO** | Integración | Inconsistencia | — |
| ~~F-1~~ | ~~`UsuariosPage` duplica `authApi.me()` teniendo `useAuth`~~ · **RESUELTO** | Frontend | Duplicación | — |
| ~~F-7~~ | ~~Tres exports sin consumidor externo~~ · **RESUELTO** | Frontend | Código muerto | — |
| ~~B-1~~ | ~~"Buscar o 404" inline en 10 handlers de dos routers~~ · **RESUELTO** | Backend | Duplicación | — |
| ~~B-2~~ | ~~Validación de sector repetida~~ (eran **siete** copias, no cinco) · **RESUELTO** | Backend | Duplicación | — |
| ~~F-5~~ | ~~Permisos con el cuerpo copiado~~ · **RESUELTO** | Frontend | Duplicación | — |
| ~~F-6~~ | ~~Dos helpers de error con nombres que no distinguen~~ · **RESUELTO** | Frontend | Inconsistencia | — |
| ~~F-9 / F-10~~ | ~~`alert()` y `window.confirm` conviviendo con banners y modales~~ · **RESUELTO** | Frontend | Inconsistencia | — |
| ~~F-3~~ | ~~Overlay repetido en cinco modales~~ · **RESUELTO** | Frontend | Duplicación | — |
| ~~F-12~~ | ~~`SalonCanvas` recibe el rol por prop y por contexto~~ · **RESUELTO** | Frontend | Inconsistencia | — |
| ~~F-2~~ | ~~`horario.ts` espeja `horario.py` con otro huso~~ · **RESUELTO** | Frontend | Duplicación | — |
| ~~F-4~~ | ~~Ciclo de arrastre reimplementado~~ (eran **cuatro** instancias, no tres) · **RESUELTO** | Frontend | Duplicación | — |
| ~~F-8~~ | ~~Cuatro métodos muertos en `api.ts`~~ · **CORREGIDO**: solo uno lo estaba | Frontend | Código muerto | — |
| ~~I-3~~ | ~~Etiquetas de estado con dos fuentes de verdad~~ · **RESUELTO** como convivencia documentada | Integración | Duplicación | — |
| F-11 | `permisos.ts` contradice su propio invariante declarado | Frontend | Inconsistencia | Bajo (decisión en B-4/B-5) — **T26-199** |
| B-4 | `DELETE` con dos semánticas según el recurso | Backend | Inconsistencia | Alto (cambio de contrato) — **T26-199** |
| B-5 | El rol exigido cambia entre `PATCH` y `DELETE` | Backend | Inconsistencia | Gating — **T26-199** |
| B-3 | Dos endpoints de test de conexión, uno sin consumidor | Backend | Duplicación | Bajo (depende de B-4) |
| I-2 | Cuatro endpoints sin consumidor | Integración | Código muerto | Decisión de alcance |

**Lo que está limpio y conviene no volver a revisar:** los 33 schemas del backend (ninguno huérfano), la centralización del HTTP en `api.ts` (cero llamadas sueltas), y la ausencia de llamadas a endpoints inexistentes.

**Sobre el método de este informe.** Dos de los recuentos salieron mal y los dos por el mismo
motivo: buscar una llamada con un patrón de una sola línea. F-8 marcó muertos dos métodos que
se invocan encadenados en dos líneas, y sobre uno de esos falsos positivos se apoyaba la
recomendación de I-3 (dar de baja `GET /estados/`), que habría roto `ConfiguracionPage`. B-2
contó cinco copias donde había siete, ahí por una razón distinta: dos tickets posteriores
agregaron una cada uno. El primero es un error de herramienta; el segundo, la vida útil de un
relevamiento. Vale para la próxima auditoría: ningún "cero consumidores" debería darse por
bueno sin abrir el archivo.

---

# 5. Dependencias de `vision-module` — para la segunda pasada

Tres puntos de este informe no se pueden cerrar sin mirar `vision-module`, que quedó fuera de alcance por T26-197:

1. **`GET /mesas/{id}` y `POST /camaras/{id}/deteccion-actual`** figuran sin consumidor en el frontend y **no se marcaron como muertos** porque los usa `vision-module/app/client/backend_client.py` (líneas 142 y 156). Si ese cliente cambia en T26-197, hay que revalidar que sigan teniendo consumidor.

2. **B-4 (semántica de `DELETE`) toca a vision-module indirectamente.** El módulo lee mesas con `GET /mesas/` y filtra por estado; pasar mesas y sectores a baja lógica cambiaría qué filas devuelve ese listado. La decisión no debería tomarse sin verificar cómo el módulo trata las mesas inactivas.

3. **F-2 (la regla de horario duplicada) gana un tercer lado si vision-module llega a consumirla.** Hoy no la usa —lee `confirmacion_segundos` y `overlap_minimo` de `/configuracion`, no las horas—, pero es el mismo endpoint, así que conviene confirmarlo cuando el módulo se estabilice.

Además, y fuera del alcance de este informe pero relevante para planificar: la instrumentación de latencia de T26-181 **no persiste nada** (solo loguea a stderr, sin archivo ni rotación). Quedó documentado en el relevamiento de T26-188/RF-27 y es el insumo que faltaría para auditar el rendimiento del pipeline.


---

# 6. Estado de los hallazgos

Actualizado al 2026-09-13. Esta sección se mantiene a mano: el informe es el relevamiento, y
acá se anota qué se fue cerrando para no tener que releerlo entero.

T26-200 aplicó el grueso de lo pendiente en tres tandas. Lo que quedó abierto tiene ticket
propio (T26-199) o depende de una decisión de contrato.

| Hallazgo | Estado | Dónde se resolvió |
|---|---|---|
| I-1 · barras finales que provocaban 307 | **Resuelto** | `services/api.ts:91` y `:172` |
| F-1 · `UsuariosPage` duplicaba `authApi.me()` | **Resuelto** | ahora consume `useAuth()` |
| F-7 · los tres exports sin consumidor | **Resuelto** | `esEncargado` eliminado; `TAMANO_MINIMO_SALON` y `formatearNumeroCsv` pasaron a privados |
| B-1 · "buscar o 404" inline | **Resuelto** (T26-200, tanda 1) | `_obtener()` en `mesas.py` (7 sitios) y `sectores.py` (3) |
| B-2 · validación de sector repetida | **Resuelto** (T26-200, tanda 1) | `routers/_comun.py` nuevo; **7** sitios, no 5 — T26-185 y T26-186 habían sumado una copia cada uno después del relevamiento |
| F-8 · métodos muertos de `api.ts` | **Resuelto parcial + corregido** (T26-200, tanda 1) | Solo `camarasApi.obtener` estaba muerto: eliminado. Dos de los cuatro del informe tenían consumidor — ver la corrección en F-8. `sectoresApi.eliminar` espera a B-4 |
| F-3 · overlay repetido en cinco modales | **Resuelto** (T26-200, tanda 2) | `components/Modal.tsx` |
| F-5 · permisos con el cuerpo copiado | **Resuelto** (T26-200, tanda 2) | `tieneRol(rol, ...permitidos)` privado en `permisos.ts` |
| F-6 · dos helpers de error | **Resuelto** (T26-200, tanda 2) | Quedó uno solo, el asíncrono, con el nombre `extraerDetalle`. 35 call sites |
| F-9 · `alert()` conviviendo con banners | **Resuelto** (T26-200, tanda 2) | Los 9 fuera. `hooks/useAvisoError.tsx` para los tres del canvas; banner propio en `DashboardPage` |
| F-10 · `window.confirm` | **Resuelto** (T26-200, tanda 2) | `components/ModalConfirmacion.tsx`, los 5 sitios |
| F-12 · `SalonCanvas` recibía el rol por prop | **Resuelto** (T26-200, tanda 2) | lee `useAuth()`; la prop `esAdmin` no existe más |
| F-4 · arrastre reimplementado | **Resuelto** (T26-200, tanda 3) | `hooks/useArrastre.ts`; eran **cuatro** instancias, no tres (el resize del sector es otra) |
| F-2 · `horario.ts` espejaba `horario.py` | **Resuelto** (T26-200, tanda 3) | El backend responde "¿está abierto ahora?" en `GET /metricas/ocupacion` (`local_abierto`); `enHorarioDeServicio` dado de baja |
| I-3 · etiquetas con dos fuentes de verdad | **Resuelto como convivencia documentada** (T26-200, tanda 3) | Ver I-3: los dos se quedan, con el porqué anotado en `routers/estados.py` |
| B-3 · dos endpoints de test de conexión | Pendiente | Depende de B-4/B-5 (el segundo no tiene consumidor) |
| B-4 · `DELETE` con dos semánticas | **Pendiente — T26-199** | Cambio de contrato |
| B-5 · rol distinto entre PATCH y DELETE | **Pendiente — T26-199** | Gating |
| F-11 · `permisos.ts` contradice su invariante | **Pendiente — T26-199** | Depende de B-4/B-5 |
| I-2 · endpoints sin consumidor | Pendiente | `POST /camaras/test-conexion`, `POST /auth/register`, `GET /sectores/{id}`, `GET /roi-mesa/{id}`. Cada uno es una decisión de alcance, no un fix |

## Hallazgos nuevos, posteriores al relevamiento

Aparecieron trabajando sobre el código después de cerrar la auditoría. Se anotan acá para no
perderlos, con el mismo formato que el resto.

### N-1 · `11-rotacion.spec.ts` dependía de la hora del día · **RESUELTO**

Desde que se cargó un horario de servicio real (07:00 → 01:00), los cuatro tests del bloque
sembrado fallaban de forma determinista entre las 01:00 y las 07:00: crean sus transiciones
en el momento de correr, y `GET /metricas/rotacion` descarta las que caen fuera de la franja.
El endpoint estaba bien; el spec asumía que toda transición cuenta, cosa que era cierta
mientras `hora_apertura`/`hora_cierre` estuvieran en NULL.

Resuelto haciendo que el bloque fije su propia ventana en el `beforeEach` y la restaure en el
`afterEach`, el mismo patrón que usan los specs 20, 21 y 23. Verificado poniendo el horario
global en una ventana que excluye la hora actual: los 6 tests pasan igual.

### N-2 · `/usuarios` no tenía ningún test e2e · **RESUELTO**

Detectado al cruzar pantallas contra specs: la pantalla de administración de usuarios, con
tres salvaguardas de negocio que el backend devuelve como 409, no tenía cobertura. Cubierto
por `e2e/tests/23-usuarios.spec.ts` (8 casos). Para que fuera testeable hubo que agregarle
`data-testid` por fila, que la pantalla no tenía — parte de por qué llegó sin cobertura.

### N-3 · Dos specs numerados 16 · **RESUELTO**

`16-filtro-estado` y `16-ocupacion-diaria` colisionaban. El segundo pasó a `22-`, respetando
que el número identifica la sección y que el 16 ya estaba tomado.
