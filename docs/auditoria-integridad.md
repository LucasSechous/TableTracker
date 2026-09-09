# Auditoría de integridad — TableTracker

**Fecha:** 2026-09-07
**Rama auditada:** `develop` @ `4c23f39` (0 ahead / 0 behind vs `origin/develop`, working tree limpio)
**Alcance:** RF-01 a RF-34, RNF de la sección 9.2, estado de base de datos, testing, deuda conocida y consistencia documental.
**Naturaleza:** solo lectura. No se modificó código, no se corrieron migraciones, no se commiteó ni pusheó nada. El único archivo creado es este.

## Advertencia de método

`docs/fica.pdf` pesa **0 bytes**: el anteproyecto no está en el repositorio. El catálogo RF-01..RF-38 y las secciones 8.2 / 8.4 / 9.1 usados acá fueron provistos por el tesista en la conversación, no leídos del repo. Las secciones **9.2 (RNF)** y **8.5** no se recibieron en texto: la sección 2 de este informe audita los nueve RNF por su **nombre**, no contra su redacción original.

Dos decisiones de alcance ya cerradas se respetan y **no** se reportan como faltantes:
- **RF-29** está descopeado a solo-lectura (`GET /estados/`) por decisión documentada.
- **RF-35 a RF-38** (reservas) están fuera del MVP a propósito y no se auditaron.

---

## 1. Requerimientos funcionales (RF-01 a RF-34)

### 1. Gestión de autenticación y usuarios

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-01 Inicio de sesión | **Implementado** | `backend/app/routers/auth.py:148` `login()`; `frontend/src/pages/LoginPage.tsx`; e2e `02-login.spec.ts` (2.1–2.5) | JWT HS256, expiración 30 min. Rate limit de 5 intentos fallidos/min por IP (`auth.py:54-65`), solo cuenta fallos. |
| RF-02 Gestión de roles | **Parcial** | `backend/app/routers/auth.py:112` `requiere_rol()`; matriz completa en `docs/roles-permisos.md` | La **aplicación** del rol está completa y probada endpoint por endpoint. Falta la **gestión**: el rol se fija en el alta y no hay forma de cambiarlo. `User.rol` es `String` libre, sin enum ni CHECK (`backend/app/models/user.py:14`): un typo (`"admim"`) crea un usuario que no pasa ningún `requiere_rol` y solo falla como 403 al primer uso. |
| RF-03 Alta, baja y modificación de usuarios | **Parcial — solo el alta** | `backend/app/routers/auth.py:128` `register()` (exige admin) | **No existe** listado, edición ni baja de usuarios: ni endpoint, ni pantalla, ni función en `frontend/src/services/api.ts`. La columna `User.activo` existe en el modelo pero **ningún endpoint la lee ni la escribe**. El primer admin se crea por script (`backend/app/seed_admin.py`). Ver §6: el Capítulo 2 documenta esto como completo. |

### 2. Gestión del salón y mesas

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-04 Registro de mesas | **Implementado** | `backend/app/routers/mesas.py:68` `crear_mesa()`; `frontend/src/components/ModalAltaMesa.tsx` | UNIQUE `(numero, sector_id)` con 409 propio (`models/mesa.py:19`). |
| RF-05 Configuración del plano del salón | **Implementado** | `models/sector.py` (`pos_x/pos_y/ancho/alto`), `models/mesa.py` (`pos_x/pos_y`); `mesas.py:179` `actualizar_posicion_mesa()`; `frontend/src/components/SalonCanvas.tsx`; e2e `05-canvas-edicion.spec.ts` (10 tests) | Tamaño del salón configurable vía `GET/PATCH /configuracion`. Piso de tamaño calculado en `frontend/src/constants.ts:calcularMinimoSalon` — el backend solo valida `gt=0`. |
| RF-06 Edición de mesas | **Implementado** | `backend/app/routers/mesas.py:88` `actualizar_mesa()` | Sin test unitario dedicado (ver §4). |
| RF-07 Eliminación o desactivación de mesas | **Implementado** | `mesas.py:197` `eliminar_mesa()` (solo admin); baja lógica vía `PATCH {activa:false}` usada por `frontend/src/services/api.ts:107` | Conviven baja física (admin) y baja lógica. El e2e usa la lógica porque la FK con `historial_estados` bloquea el DELETE (`04-canvas-monitoreo.spec.ts:52`). |

### 3. Detección automática mediante visión por computadora

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-08 Captura de imágenes/video | **Implementado** | `vision-module/app/capture/camera.py`; `backend/app/services/rtsp.py`; `camaras.py:260` `capturar_snapshot()` | Soporta RTSP, webcam y archivo (`VIDEO_SOURCE`). Hilo lector con reconexión (`FRAMES_FALLIDOS_MAXIMOS`, `RECONEXION_SEGUNDOS`) y detección de stream muerto (`FRAME_ANTIGUEDAD_MAXIMA_SEGUNDOS`). 21 tests en `test_camera.py`, 26 en `backend/tests/test_rtsp.py`. |
| RF-09 Procesamiento mediante IA | **Implementado** | `vision-module/app/detection/detector.py` (YOLO/ultralytics) | **El modelo por defecto es `yolov8s`, no `yolov8n`** (`config.py:YOLO_MODEL_PATH`, `imgsz=960`), elegido por medición documentada en T26-178/179. El anteproyecto y el README citan YOLOv8n — ver §6. |
| RF-10 Detección automática del estado | **Implementado** | `vision-module/app/mapping/zonas.py` (overlap bbox∩ROI), `confirmacion.py` (sostenido `CONFIRMACION_SEGUNDOS`), `politica.py` (estado destino) | 27 + 11 + 11 tests. La política nunca escribe `libre`: solo `ocupada` y `pendiente_limpieza`. |
| RF-11 Actualización automática del estado | **Implementado** | `vision-module/app/main.py:247` `aplicar_cambio()` → `PATCH /mesas/{id}/estado`; `mesas.py:130` acepta `ROL_VISION_MODULE` | Aplicación fuera del ciclo con pool de hilos (`AplicadorEnSegundoPlano`, T26-183) para no degradar la cadencia. 47 tests en `test_main.py`. |
| RF-12 Asociación cámara ↔ sector del salón | **Implementado** | `models/camara.py:52` (`sector_id` NOT NULL); `models/roi_mesa.py` + `backend/app/routers/roi.py`; `frontend/src/pages/CalibracionRoiPage.tsx` | La asociación es más fina que lo que pide el RF: además de cámara→sector hay ROI poligonal por **mesa** dentro de cada cámara, con UNIQUE `(mesa_id, camara_id)`. 26 tests en `test_roi.py`. |

### 4. Visualización en tiempo real

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-13 Panel principal de monitoreo | **Implementado** | `frontend/src/pages/DashboardPage.tsx`; e2e `04-canvas-monitoreo.spec.ts` | Refresco automático por polling cada 3 s (`INTERVALO_REFRESCO_MESAS_MS`). |
| RF-14 Visualización por colores/indicadores | **Implementado** | `frontend/src/constants.ts` (`COLOR_POR_ESTADO`, `BORDE_POR_ESTADO`, `ETIQUETA_POR_ESTADO`); `MesaVisual.tsx`; e2e 4.2 | Paleta compartida entre canvas, leyenda y panel de ocupación. |
| RF-15 Filtrado por estado de mesa | **Parcial — sin UI** | `backend/app/routers/mesas.py:46` acepta `estado: Optional[EstadoMesa]` y filtra en `:55` | El backend lo soporta y funciona. **El frontend no lo expone**: no hay control de filtro en `DashboardPage.tsx` ni parámetro `estado` en las llamadas de `services/api.ts`. Sin test e2e ni unitario. |
| RF-16 Visualización por sectores | **Implementado** | `frontend/src/components/SectorBloque.tsx`; agrupación en `DashboardPage.tsx`; filtro `sector_id` en `/mesas`, `/metricas/ocupacion` y `/metricas/rotacion`; e2e 4.1 y 11.4 | |

### 5. Gestión manual de estados

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-17 Cambio manual del estado | **Implementado** | `mesas.py:122` `cambiar_estado_mesa()` (encargado/mozo/admin + vision_module); `frontend/src/components/PanelMesa.tsx`; e2e 4.3, 4.4, 6.1, 6.2 | El origen queda trazado: `origen_de(usuario)` distingue `manual` de `automatico` (`mesas.py:17`). |
| RF-18 Confirmación de mesa limpia | **Implementado** | `mesas.py:143` `limpiar_mesa()` (encargado/limpieza/admin); e2e 15.3 | Devuelve 409 si la mesa no está en `pendiente_limpieza`. 11 tests en `test_limpieza_demorada.py`. |
| RF-19 Marcado manual de mesa reservada | **Implementado** | `mesas.py:162` `reservar_mesa()` (encargado/recepcion/admin); estado alcanzable desde `PanelMesa` (e2e 4.x y 6.x lo ejercitan) | Sin test dedicado al endpoint `/reserva` en sí (§4). |

### 6. Historial y métricas operativas

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-20 Registro histórico de cambios | **Implementado** | `models/historial.py`; `mesas.py:31` `registrar_historial()` | Incluye `origen_cambio` (`automatico`/`manual`, T26-163), nullable a propósito para las filas previas. |
| RF-21 Consulta de historial | **Implementado** | `backend/app/routers/historial.py:25` `listar_historial()` (filtros mesa + rango + orden); `frontend/src/pages/HistorialPage.tsx`; e2e `08-historial.spec.ts` | Valida `fecha_inicio > fecha_fin` con 400. |
| RF-22 Métricas de ocupación | **Implementado** | `backend/app/routers/metricas.py:33` `obtener_ocupacion()`; `frontend/src/pages/OcupacionPage.tsx`; e2e `10-ocupacion.spec.ts` | Decisión explícita: `reservada` **no** suma al % de ocupación (`metricas.py:30`), verificada en e2e 10.4. |
| RF-23 Métrica de rotación | **Implementado** | `metricas.py:75` `obtener_rotacion()`; `frontend/src/pages/RotacionPage.tsx`; e2e `11-rotacion.spec.ts` (6 tests) | Rotación = transición *hacia* `ocupada`, con resolución del estado previo al rango. Recorte por horario de servicio (`services/horario.py`). 21 tests en `test_metricas.py`. |
| RF-24 Horarios de mayor demanda | **No encontrado** | — | Búsqueda sin resultados en backend, frontend y vision-module. No existe agregación por franja horaria. Prioridad Baja / versiones futuras según el propio anteproyecto. La base para calcularlo ya está (`historial_estados` + `horario.py`). |

### 7. Notificaciones y alertas

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-25 Alerta de mesa pendiente de limpieza | **Implementado (alerta visual)** | `configuracion_general.minutos_limpieza_demorada`; `frontend/src/constants.ts:limpiezaDemorada()`; `MesaVisual.tsx`; e2e `15-limpieza-demorada.spec.ts` | Es un **indicador visual en el canvas** cuando se supera el umbral, no una notificación push ni un mail. Apagado por defecto (umbral nullable). Si la defensa entiende "alerta" como notificación activa, esto es parcial. |
| RF-26 Alerta de alta ocupación | **No encontrado** | — | Sin implementación. Prioridad Baja / Opcional. El dato (`porcentaje_ocupacion`) ya lo calcula `/metricas/ocupacion`. |
| RF-27 Alerta por posible error de detección | **No encontrado** | — | Sin implementación. Prioridad Baja / Opcional. `origen_cambio` habilita medirlo a futuro (correcciones manuales sobre cambios automáticos). |

### 8. Administración del sistema

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-28 Configuración general | **Implementado** | `backend/app/routers/configuracion.py`; `models/configuracion.py`; `frontend/src/pages/ConfiguracionPage.tsx`; e2e `12-configuracion.spec.ts`; 7 tests en `test_configuracion.py` | Fila única (CHECK `id=1`). Cubre nombre, dimensiones, mesas de referencia, horario de servicio y umbral de limpieza. |
| RF-29 Configuración de estados | **Descopeado a solo-lectura (decisión cerrada)** | `backend/app/routers/estados.py:1-9` documenta el descope; `test_estados.py` | **No es un gap.** El propio código explica que `EstadoMesa` está hardcodeado en frontend, backend y vision-module y que migrarlo a tabla dinámica era riesgoso a dos sprints del cierre. |
| RF-30 Configuración de cámaras | **Implementado** | `backend/app/routers/camaras.py` (ABM completo, solo admin); `frontend/src/pages/CamarasPage.tsx`; 35 tests en `test_camaras.py` | Contraseñas RTSP cifradas con Fernet (`services/cifrado.py`), con rotación de clave sin downtime. |
| RF-31 Prueba de conexión con cámaras | **Implementado** | `camaras.py:208` `probar_conexion_camara()` y `camaras.py:237` `probar_conexion_url()` | Dos variantes: sobre cámara guardada y sobre URL suelta (antes de dar de alta). |

### 9. Reportes

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-32 Reporte de ocupación diaria | **No encontrado** | `OcupacionPage.tsx` no tiene rango de fechas ni exportación (verificado por búsqueda) | `/metricas/ocupacion` devuelve una **foto del instante**, no una serie diaria: cuenta `mesas.estado` actual, sin tocar `historial_estados`. No hay agregación por día en ningún lado. **Es el RF de prioridad Media más claramente ausente.** |
| RF-33 Reporte de ocupación por período | **Parcial** | Rango de fechas en `HistorialPage.tsx` y `RotacionPage.tsx` vía `components/RangoFechas.tsx`; e2e 11.6 y 8.3 | Se puede consultar **historial** y **rotación** por período, pero no *ocupación* por período (mismo motivo que RF-32). Prioridad Baja / Opcional para MVP. |
| RF-34 Exportación de reportes | **Implementado** | `frontend/src/csv.ts`; usado en `HistorialPage.tsx:130` y `RotacionPage.tsx:123`; e2e `14-exportar-csv.spec.ts` (3 tests) | CSV generado en cliente, calibrado para Excel en español (BOM, `;`, coma decimal, CRLF, fecha dd/mm/aaaa). No cubre el panel de ocupación (no hay qué exportar ahí todavía). |

### Resumen del punto 1

| Estado | Cantidad | RFs |
|---|---|---|
| Implementado | 24 | 01, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 25, 28, 30, 31, 34 |
| Parcial | 4 | 02, 03, 15, 33 |
| No encontrado | 4 | 24, 26, 27, 32 |
| Descopeado (decisión cerrada) | 1 | 29 |

Los cuatro "no encontrado" son tres de prioridad **Baja/Opcional** (24, 26, 27) y uno de prioridad **Media** (32). RF-25 pasa a "Parcial" si la tesis entiende "alerta" como notificación activa y no como indicador visual.

---

## 2. Requerimientos no funcionales (sección 9.2)

> Sin el texto de 9.2 a la vista, cada RNF se evalúa por su nombre. La columna Estado responde: ¿hay código que sostenga la afirmación, o es declaración de intención?

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| Usabilidad | **Respaldo parcial** | `components/ErrorBoundary.tsx`; `extraerDetalleApi()` en `services/api.ts:343`; `MenuLateral.tsx`; e2e 1.1/1.4/6.3 | Hay banners de error consistentes, boundary que evita la pantalla en blanco y prueba en dos viewports. **Sin respaldo:** no hay test de accesibilidad, ni diseño responsive real (el canvas es 1200×700 fijo con `overflow:hidden`), ni prueba con usuarios documentada. |
| Rendimiento | **Respaldo fuerte y medido** | `vision-module/app/config.py` (tabla de costo p90 por modelo × resolución, T26-178/179); `registrar_presupuesto()` en `main.py:520`; `APLICADOR_HILOS` (T26-183); `mesas.estado_desde` denormalizado (`models/mesa.py`) | Es el RNF mejor sostenido: hay presupuesto explícito (2 s por ciclo), mediciones reproducibles y dos optimizaciones justificadas por número. **Del lado web no hay medición**: el dashboard hace polling cada 3 s contra Supabase remoto sin presupuesto declarado. |
| Seguridad | **Respaldo fuerte, con huecos conocidos** | bcrypt (`auth.py:70`); JWT 30 min; `requiere_rol()` + matriz en `docs/roles-permisos.md`; rate limit de login (`auth.py:54`); Fernet para credenciales de cámara (`services/cifrado.py`); CORS por lista explícita (`main.py:33`) | Sólido y probado (35 tests de cámaras, 26 de ROI, incluidos los de rol). **Huecos:** (a) el rate limit es un dict en memoria — se pierde al reiniciar y no sirve con más de un worker; (b) `User.rol` sin enum ni CHECK; (c) el frontend no bloquea por rol la edición de layout (un `mozo` ve el botón y recibe 403 recién al usarlo, `docs/roles-permisos.md` §Fuera de alcance). |
| Confiabilidad | **Respaldo fuerte** | Reconexión RTSP (`camera.py`), tolerancia a stream muerto (`INTERVALOS_TOLERADOS_SIN_FRAME`), confirmación sostenida antes de escribir (`confirmacion.py`), tope de cola por mesa (`APLICADOR_MAXIMO_POR_MESA`), 409 en vez de 500 para choques UNIQUE (`database.py:es_violacion_unique`) | 368 tests unitarios en verde + 62 e2e. La confirmación por tiempo es exactamente la defensa contra falsos positivos. |
| Escalabilidad | **Declaración de intención** | — | El sistema asume **un solo local** (`horario.py:TZ_LOCAL`, "TableTracker administra UN local físico"), **una sola cámara por corrida** del módulo (`SECTOR_ID`/`CAMARA_ID`) y **backend single-worker** (el dict `_ultima_deteccion` en `camaras.py:57` y el rate limit dejan de ser correctos con más de uno). Nada de esto impide la defensa, pero no hay código que sostenga una afirmación de escalabilidad horizontal. |
| Mantenibilidad | **Respaldo fuerte** | Separación por capas (`models`/`schemas`/`routers`/`services`); `vision-module` como proceso independiente con capas propias; Alembic como única fuente del esquema (`database/README.md`); 368 tests; densidad de comentarios explicativos muy alta (el porqué, no el qué) | Cero `TODO`/`FIXME`/`HACK`/`XXX` en todo el código y cero `NotImplementedError` vivos. Es notable y conviene decirlo en la defensa. |
| Disponibilidad | **Declaración de intención** | `ErrorBoundary`, reconexión de cámara, fallo silencioso al publicar detección (`main.py`) | Hay tolerancia a fallos *dentro* del proceso, pero **no hay despliegue**: no existe Dockerfile, CI, healthcheck, supervisor ni proceso de arranque automático en el repo. La disponibilidad hoy depende de que alguien levante `uvicorn` y `npm run dev` a mano. |
| Compatibilidad | **Respaldo débil** | `playwright.config.ts` corre **solo** `chromium` (`projects: [{name:"chromium"}]`) | Un único navegador probado. Sin Firefox ni WebKit, sin matriz de resoluciones más allá de e2e 6.3. El backend es multiplataforma pero `playwright.config.ts` hardcodea `venv/Scripts/python.exe` (ruta Windows). |
| Privacidad | **Respaldo fuerte y documentado** | `docs/privacidad-vision.md` (auditoría de escritura de imágenes, ausencia de biometría, tratamiento no diferenciado de personas); `.gitignore` sobre `data/samples/`; enmascarado de contraseña en URLs (`utils/rtsp_url.enmascarar`) | El pipeline de producción no persiste imágenes; las dos excepciones (vista en vivo en memoria, banco de pruebas en disco) están documentadas con qué/dónde/activación/retención. **Pero el documento está desactualizado** — ver §6. |

---

## 3. Estado de la base de datos

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| `alembic current` | **En head** | `9b2f1d64ce70 (head)` | Ejecutado contra la Supabase real (`aws-1-us-east-2.pooler.supabase.com`). Solo lee `alembic_version`. |
| `alembic heads` | **Un solo head** | `9b2f1d64ce70` | Sin ramas ni merge pendiente. |
| Cadena de revisiones | **Lineal y completa (7)** | `e72cc6e493dc → 903cf408bb66 → 6597e37ddeab → 841471d74b5b → 4d9e1c7ab205 → 7c3a5e01b8f4 → 9b2f1d64ce70` | Verificado archivo por archivo (`revision`/`down_revision`) y contra `alembic history`. Los 7 archivos de `database/versions/` coinciden exactamente con la cadena. |
| **Revisión `4d9e1c7ab205`** (columna `origen_cambio`) | **Ninguna de las tres opciones planteadas** | Archivo `database/versions/4d9e1c7ab205_origen_del_cambio_de_estado.py`; commit `a12de6b`; `git branch -r --contains` la ubica en `origin/develop` | **Está comiteada, pusheada y además aplicada en la base.** No está sin commitear (working tree limpio), ni sin pushear (`develop` 0 ahead/0 behind), ni ausente. Es ancestro de `current`, así que la columna existe en Supabase. |
| Drift esquema ↔ modelos | **Sin evidencia de drift** | `database/env.py` con `compare_type` y `compare_server_default`; `backend/scripts/verificar_esquema_versionado.py` | No se corrió el verificador (crea un schema descartable en la base: es escritura, fuera del alcance de solo-lectura de esta auditoría). Se recomienda correrlo antes de la defensa. |
| `database/README.md` | **Desactualizado** | La tabla "Revisiones" lista 4 de 7 | Faltan documentar `4d9e1c7ab205` (origen del cambio), `7c3a5e01b8f4` (horario de servicio) y `9b2f1d64ce70` (limpieza demorada). |

---

## 4. Testing

### Resultados tal como salen

| Suite | Comando | Resultado | Tiempo |
|---|---|---|---|
| Backend (pytest) | `backend/venv/Scripts/python.exe -m pytest -q` | **184 passed, 0 failed, 0 skipped** | 54.76 s |
| vision-module (pytest) | `vision-module/venv/Scripts/python.exe -m pytest -q` | **184 passed, 0 failed, 0 skipped** | 21.80 s |
| E2E (Playwright) | `npx playwright test` | **62 passed, 3 skipped, 0 failed** (65 total) | 10.5 min |

> Los dos "184" son coincidencia, no un error de configuración: se verificó que cada corrida tiene su propio `rootdir` y recolecta sus propios módulos. Total: **430 pruebas en verde**.

Los 3 skipped de e2e (confirmados con una corrida dirigida a esos specs):

| Test | Motivo del skip | ¿Preocupa? |
|---|---|---|
| 4.5 mesa sin sector asignado | `test.skip(true, ...)` incondicional: el modelo exige `sector_id` NOT NULL, no se puede crear una mesa huérfana sin tocar la base a mano | No — es una imposibilidad de diseño, documentada en el propio test |
| 9.1 crear ROI dibujando sobre frame real | La cámara física de prueba no está activa en la base | **Sí, parcialmente** — es el único test que ejercita la calibración de ROI contra hardware real; hoy no corre |
| 15.1 sin umbral configurado no se marca ninguna mesa | Hay un umbral cargado en la base y la API no permite borrarlo (`exclude_none`) | Menor, pero delata una limitación real: **no se puede apagar `minutos_limpieza_demorada` desde la API una vez cargado** |

### RFs sin ningún test asociado (ni e2e ni unitario)

| RF | Cobertura | Detalle |
|---|---|---|
| RF-03 Alta/baja/modificación de usuarios | **Solo el alta** | `test_auth.py::test_register_exige_admin`. Baja y modificación no existen, así que no hay nada que probar. |
| RF-15 Filtrado por estado | **Ninguna** | El parámetro `estado` de `GET /mesas/` no tiene test unitario ni e2e. Es código sin cobertura *y* sin UI. |
| RF-24 Horarios de mayor demanda | **Ninguna** | No implementado. |
| RF-26 Alerta de alta ocupación | **Ninguna** | No implementado. |
| RF-27 Alerta por error de detección | **Ninguna** | No implementado. |
| RF-32 Reporte de ocupación diaria | **Ninguna** | No implementado. |

### Hueco estructural de cobertura unitaria

El backend **no tiene** `test_mesas.py`, `test_sectores.py` ni `test_historial.py`. Los routers de mesas, sectores e historial —que son el núcleo de RF-04 a RF-07 y RF-16 a RF-21— están cubiertos **solo por e2e**, que corre contra la base real, tarda 10 minutos y depende de que Vite y uvicorn levanten. Es el hueco de testing más relevante: un cambio en `mesas.py` puede romper RF-17 y `pytest` seguiría en verde.

RF-19 (`PATCH /mesas/{id}/reserva`) y RF-06 (`PATCH /mesas/{id}`) se ejercitan de refilón en e2e, pero ningún test los tiene como sujeto.

---

## 5. Deuda conocida

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| Umbrales de detección hardcodeados en `.env` (T26-172) | **Sigue abierta** | `vision-module/app/config.py` lee `YOLO_CONFIDENCE`, `OVERLAP_MINIMO`, `CONFIRMACION_SEGUNDOS`, `ANCLAJE_OVERLAP` con `os.getenv`; `configuracion_general` no tiene columnas de umbrales | Hay trabajo en curso **sin mergear**: rama `origin/T26-172-umbrales-de-deteccion-editables-desde-la-aplicacion-sin-editar-el-env`, 1 commit (`01ac841`, 2026-09-07) que no está en `develop`. Cambiar un umbral hoy exige editar el `.env` y reiniciar el módulo. |
| `TODO` / `FIXME` / `HACK` / `XXX` | **Ninguno** | Búsqueda estricta de marcadores en comentarios sobre backend, frontend, e2e, vision-module y database: **cero resultados**. Cero `NotImplementedError` vivos. | Los ~11 matches de una búsqueda laxa (`temporal`, `pendiente`, `por ahora`) son prosa explicativa dentro de comentarios que documentan decisiones, no marcadores de deuda. Es un dato a favor para la defensa. |
| Rol `vision_module` de solo lectura sobre `/camaras/` y `/roi-mesa/` | **La corrección del Sprint 6 sigue vigente y está protegida por tests** | Permisos declarados **por endpoint**, no en el `APIRouter`: `camaras.py:36-45` y `roi.py:21-27`. Regresiones: `test_camaras.py:285` y `test_roi.py:238`, ambas pasando | Ver matiz abajo. |

### Matiz sobre el rol `vision_module`

No es literalmente "solo lectura", y conviene decirlo con precisión en la defensa. El rol llega **exactamente** a tres endpoints:

| Endpoint | Verbo | ¿Escribe? |
|---|---|---|
| `/camaras/` | GET | No |
| `/roi-mesa/` | GET | No |
| `/camaras/{id}/deteccion-actual` | **POST** | Sí, pero a un **dict en memoria del proceso** (`camaras.py:57`), no al registro de la cámara ni a Supabase |

Todo el resto de `/camaras/*` y `/roi-mesa/*` le devuelve **403**, incluidos `GET /camaras/{id}` y el snapshot. El test `test_vision_module_solo_llega_al_listado_y_a_deteccion_actual` verifica los seis 403 uno por uno. Por fuera de esos routers, el rol también tiene `PATCH /mesas/{id}/estado`, que es su función principal (RF-11) y es correcto que lo tenga.

La causa raíz del bug original está documentada y neutralizada: el permiso vivía en el `APIRouter`, que no distingue verbos, y por eso el usuario técnico podía dar de alta y borrar cámaras. Hoy el router solo exige estar autenticado y cada endpoint declara su rol — con una advertencia explícita en `camaras.py:31` sobre el riesgo de agregar un endpoint sin `dependencies=`.

**Observación menor:** el commit de la rama T26-172 lleva `(T26-183)` en el mensaje, pero T26-183 ya está mergeado aparte en `a0a6fd7`. Ticket mal referenciado.

---

## 6. Consistencia documentación ↔ código

### El código tiene funcionalidad que las secciones 8.2 / 8.4 / 9.1 no mencionan

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| ROI poligonal por mesa | **Falta documentar** | `models/roi_mesa.py`, `routers/roi.py`, `CalibracionRoiPage.tsx` | RF-12 solo habla de "asociación entre cámara y sector". El sistema hace bastante más: polígono por mesa, calibración visual sobre frame real, edición de vértices. Es de lo más vistoso del proyecto y no figura en el catálogo. |
| Cifrado de credenciales de cámara | **Falta documentar** | `services/cifrado.py`, `scripts/rotar_clave_camaras.py` | Fernet + rotación de clave sin downtime. Ningún RF lo pide; es una decisión de seguridad propia. |
| Trazabilidad del origen del cambio | **Falta documentar** | `models/historial.py:OrigenCambio`, `mesas.py:17` | Distingue cambios `automatico` vs `manual`. RF-20 solo pide "registro histórico". Habilita medir precisión de la detección. |
| Horario de servicio | **Falta documentar** | `services/horario.py`, `configuracion_general.hora_apertura/hora_cierre` | Recorta las métricas a la franja de servicio, incluido el caso 20:00→02:00. No lo pide ningún RF. |
| Alerta de limpieza demorada | **Parcialmente cubierto** | T26-173, `constants.ts:limpiezaDemorada()` | Encaja en RF-25 pero con umbral configurable, que el RF no menciona. |
| Vista en vivo de detecciones | **Falta documentar** | `POST/GET /camaras/{id}/deteccion-actual`, `hooks/useDeteccionActual.ts` | Overlay de bounding boxes en tiempo real sobre el frame. Sin RF asociado. |
| Exportación CSV calibrada para Excel es-AR | **Cubierto por RF-34, pero sin detalle** | `frontend/src/csv.ts` | El RF dice "exportación de reportes"; el trabajo real (BOM, `;`, coma decimal, CRLF) merece una línea. |
| Banco de pruebas reproducible de detección | **Falta documentar** | `vision-module/scripts/capturar_muestras.py`, `benchmark_deteccion.py`, `docs/banco-pruebas-vision.md` | Metodología de medición (T26-182) con resultados versionados. Es evidencia metodológica fuerte para una tesis. |
| Soft-delete generalizado | **Falta documentar** | `activa`/`activo` en mesas, sectores, cámaras y ROI; `incluir_inactivos` | RF-07 habla de "eliminación o desactivación" solo para mesas. |

### Las secciones documentan cosas que el código no tiene

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| `PUT /auth/users/{id}` y `PATCH /auth/users/{id}/deactivate` | **Documentados pero inexistentes** | `docs/roles-permisos.md:112` lo denuncia explícitamente; `auth.py` solo tiene `/register`, `/login`, `/me` | El Capítulo 2 (bitácora) los documenta **y marca RF-02/RF-03 como "✓ Completado"**. Ninguno de los dos existe. **Es la inconsistencia más grave del informe**: es documentación que afirma como terminado algo que no está. |
| "Procesamiento mediante YOLOv8n" | **Desactualizado** | `config.py:YOLO_MODEL_PATH` → `models/yolov8s.pt`, `imgsz=960` | El default real es **yolov8s**, cambiado por medición (T26-178/179). El enunciado del proyecto y `vision-module/README.md` citan yolov8n. Corregir en la tesis, o explicar el cambio como hallazgo (es defendible y está medido). |
| RF-29 "Configuración de estados disponibles" | **Descopeado — ya cerrado** | `routers/estados.py:1-9` | No es un gap. Solo verificar que la tesis refleje el descope en 8.5. |
| `docs/privacidad-vision.md` §2 | **Desactualizado** | Afirma que `main.py` y `zonas.py` "elevan `NotImplementedError` como marcador de trabajo pendiente" | **Ambos están implementados** (47 y 27 tests). El doc quedó congelado en Sprint 5. Es un documento de privacidad que probablemente se cite en la defensa: hoy subestima el sistema. |
| `docs/privacidad-vision.md` §3 (activación) | **Desactualizado** | Dice que los endpoints de detección están "protegidos por `requiere_rol(ROL_ADMIN)`, igual que el resto del router" | Desde T26-152 el POST acepta también `vision_module`. |
| `vision-module/.env.example` | **Desactualizado** | Comentario: "`/camaras` y `/roi-mesa` son solo admin, así que el rol de este usuario tiene que poder leerlos" | Obsoleto desde el rol dedicado `vision_module`. Induce a configurar el módulo con un admin, que es exactamente el bug que T26-152 cerró. |
| `database/README.md` tabla de revisiones | **Incompleta** | 4 de 7 documentadas | Faltan `4d9e1c7ab205`, `7c3a5e01b8f4`, `9b2f1d64ce70`. |
| `docs/fica.pdf` | **Vacío (0 bytes)** | `wc -c docs/fica.pdf` → `0` | El anteproyecto no está versionado. Cualquier auditoría futura arranca sin la fuente de verdad. |

---

## Resumen ejecutivo — bloqueantes antes de octubre

1. **RF-02/RF-03 documentados como "✓ Completado" en el Capítulo 2 sin que existan los endpoints.** Riesgo más alto de la defensa: no es un gap técnico, es documentación falsa y verificable en 30 segundos. Corregir la tesis o implementar el ABM de usuarios.
2. **`docs/privacidad-vision.md` desactualizado**: dice que el pipeline no está implementado. Es el documento que respalda el RNF de privacidad y hoy subestima el sistema propio.
3. **RF-32 (reporte de ocupación diaria), prioridad Media, ausente.** Único "no encontrado" que no es de prioridad Baja/Opcional.
4. **Sin `test_mesas.py` / `test_sectores.py` / `test_historial.py`**: el núcleo del MVP depende solo de una suite e2e de 10 minutos contra la base real.
5. **La tesis cita YOLOv8n; el código corre YOLOv8s con imgsz 960.** Está medido y es defendible — pero hay que contarlo, no que lo descubra el tribunal.
6. **T26-172 sin mergear** (rama con 1 commit): los umbrales siguen exigiendo editar `.env` y reiniciar.
7. **RF-15 sin UI**: el filtro por estado existe en el backend y no se puede usar. Es el gap más barato de cerrar.
8. **Test 9.1 (calibración ROI sobre cámara real) se saltea** por falta de la cámara de prueba activa: la integración con hardware no se está verificando.
9. **`database/README.md` documenta 4 de 7 migraciones** y **`docs/fica.pdf` está vacío**: la documentación de respaldo tiene huecos.
10. **A favor y conviene decirlo:** 430 tests en verde, cero `TODO`/`FIXME`/`HACK` en todo el código, base en head sin drift, y la corrección de permisos del Sprint 6 sigue vigente y protegida por regresiones.
