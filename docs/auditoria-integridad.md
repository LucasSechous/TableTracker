# Auditoría de integridad — TableTracker

**Auditoría original:** 2026-09-07, rama `develop` @ `4c23f39`
**Revisión vigente:** 2026-10-05, sobre `develop` tras el merge de `feature/alta-de-usuarios-y-nombre-editable` (`e2fb4a8`), que es el commit que cierra RF-03. `develop` y `main` quedan con contenido idéntico y no hay ninguna otra rama con trabajo sin mergear.
**Alcance:** RF-01 a RF-34, RNF de la sección 9.2, estado de base de datos, testing, deuda conocida y consistencia documental.
**Naturaleza:** solo lectura sobre el código. No se corrieron migraciones ni se modificó la base; lo único que se escribió es este archivo.

## Advertencia de método

`docs/fica.pdf` **ya no está en el repositorio** (en la auditoría original existía pero pesaba 0 bytes). El catálogo RF-01..RF-38 y las secciones 8.2 / 8.4 / 9.1 usados acá fueron provistos por el tesista en conversación, no leídos del repo. Las secciones **9.2 (RNF)** y **8.5** no se recibieron en texto: la sección 2 de este informe audita los nueve RNF por su **nombre**, no contra su redacción original.

Dos decisiones de alcance ya cerradas se respetan y **no** se reportan como faltantes:
- **RF-29** está descopeado a solo-lectura (`GET /estados/`) por decisión documentada.
- **RF-35 a RF-38** (reservas) están fuera del MVP a propósito y no se auditaron.

### Qué hizo esta revisión

La auditoría original quedó atrás en **once puntos**, porque entre el 2026-09-07 y hoy se cerraron los tickets T26-172, T26-175, T26-185, T26-186, T26-188, T26-199, T26-203, T26-205 y el cierre de RF-03 de esta rama. Todas las filas que cambiaron lo dicen explícitamente con la frase **"Cambió desde la auditoría original"**, y conservan qué decía antes: para la tesis ese contraste vale más que cualquiera de los dos estados por separado, porque documenta avance verificable y no una foto suelta.

Lo que se volvió a correr de verdad en esta revisión: **pytest del backend**, **pytest de vision-module** y la **suite e2e completa** (ver sección 4). Las afirmaciones sobre código se re-verificaron archivo por archivo; los números de línea de la columna Evidencia están actualizados a este commit.

---

## 1. Requerimientos funcionales (RF-01 a RF-34)

### 1. Gestión de autenticación y usuarios

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-01 Inicio de sesión | **Implementado** | `backend/app/routers/auth.py:153` `login()`; `frontend/src/pages/LoginPage.tsx`; e2e `02-login.spec.ts` (2.1–2.5) | JWT HS256, expiración 30 min. Rate limit de 5 intentos fallidos/min por IP (`auth.py:54-65`), solo cuenta fallos. |
| RF-02 Gestión de roles | **Implementado** | `auth.py:116` `requiere_rol()` (aplicación); `routers/usuarios.py:58` `actualizar_usuario()` (gestión); `select` por fila en `frontend/src/pages/UsuariosPage.tsx`; matriz completa en `docs/roles-permisos.md` | **Cambió desde la auditoría original**, que lo daba **Parcial** porque "el rol se fija en el alta y no hay forma de cambiarlo". T26-175 agregó `PATCH /usuarios/{id}` y la pantalla que lo expone. **Lo que no cambió:** `User.rol` sigue siendo `String` libre, sin `enum` ni `CHECK` (`models/user.py:14`). Un typo (`"admim"`) crea un usuario que no pasa ningún `requiere_rol` y solo falla como 403 al primer uso. La UI ofrece una lista curada (`constants.ts:ROLES_ASIGNABLES`) para no repetirlo a mano, pero es una ayuda de pantalla, no una validación. |
| RF-03 Alta, baja y modificación de usuarios | **Implementado** | Alta: `auth.py:133` `register()` (exige admin) + `frontend/src/components/ModalAltaUsuario.tsx`; listado y modificación: `routers/usuarios.py` (`GET /usuarios/`, `PATCH /usuarios/{id}` para nombre, rol y `activo`); pantalla `/usuarios` admin-only (`UsuariosPage.tsx`, `AdminRoute`); 28 tests en `test_usuarios.py`; e2e `23-usuarios.spec.ts` (13 tests) | **Cambió desde la auditoría original**, que lo daba **"Parcial — solo el alta"** y afirmaba que no existía "ni endpoint, ni pantalla, ni función en `services/api.ts`", y que `User.activo` no lo leía ni escribía ningún endpoint. Hoy las tres cosas existen: T26-175 trajo el listado, el cambio de rol y la baja lógica, y el cierre de RF-03 de esta rama sumó el **alta desde la pantalla** y el **nombre editable**. Tres salvaguardas con 409: nadie se autodesactiva ni se quita admin a sí mismo, no se deja el sistema sin admin activo, y la cuenta de servicio de vision-module no se puede desactivar. **Email y password quedan fuera a propósito**, con el motivo documentado en el docstring de `UserAdminUpdate`: el email es el `sub` del JWT y la clave con la que el router reconoce a la cuenta de vision-module, y rotar la password sin versionado de tokens dejaría la credencial vieja usable hasta que el JWT venza. El primer admin sigue creándose por script (`app/seed_admin.py`), que es correcto: `register()` exige ya ser admin. |

### 2. Gestión del salón y mesas

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-04 Registro de mesas | **Implementado** | `backend/app/routers/mesas.py:102` `crear_mesa()`; `frontend/src/components/ModalAltaMesa.tsx`; `test_mesas.py` (reactivación) | UNIQUE `(numero, sector_id)` con 409 propio (`models/mesa.py:19`). Desde T26-199 el alta sobre una mesa dada de baja la **reutiliza** en vez de chocar contra el UNIQUE. |
| RF-05 Configuración del plano del salón | **Implementado** | `models/sector.py` (`pos_x/pos_y/ancho/alto`), `models/mesa.py` (`pos_x/pos_y`); `mesas.py:280` `actualizar_posicion_mesa()`; `frontend/src/components/SalonCanvas.tsx`; e2e `05-canvas-edicion.spec.ts` (10 tests) | Tamaño del salón configurable vía `GET/PATCH /configuracion`. Piso de tamaño calculado en `frontend/src/constants.ts:calcularMinimoSalon` — el backend solo valida `gt=0`. |
| RF-06 Edición de mesas | **Implementado** | `mesas.py:138` `actualizar_mesa()` | Sigue **sin test unitario que lo tenga como sujeto** (ver §4). |
| RF-07 Eliminación o desactivación de mesas | **Implementado** | `mesas.py:298` `eliminar_mesa()`; 6 tests en `test_mesas.py` | **Cambió desde la auditoría original**, que describía "baja física (admin) y baja lógica" conviviendo. T26-199 unificó: `DELETE /mesas/{id}` **pasó a ser baja lógica**, así que ya no hay borrado físico que pueda chocar contra la FK de `historial_estados`. |

### 3. Detección automática mediante visión por computadora

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-08 Captura de imágenes/video | **Implementado** | `vision-module/app/capture/camera.py`; `backend/app/services/rtsp.py`; `camaras.py:259` `capturar_snapshot()` | Soporta RTSP, webcam y archivo (`VIDEO_SOURCE`). Hilo lector con reconexión (`FRAMES_FALLIDOS_MAXIMOS`, `RECONEXION_SEGUNDOS`) y detección de stream muerto (`FRAME_ANTIGUEDAD_MAXIMA_SEGUNDOS`). 29 tests en `vision-module/tests/test_camera.py`, 31 en `backend/tests/test_rtsp.py`. |
| RF-09 Procesamiento mediante IA | **Implementado** | `vision-module/app/detection/detector.py` (YOLO/ultralytics) | **El modelo por defecto es `yolov8s`, no `yolov8n`** (`config.py:YOLO_MODEL_PATH`, `imgsz=960`), elegido por medición documentada en T26-178/179. El anteproyecto y el README citan YOLOv8n — ver §6. |
| RF-10 Detección automática del estado | **Implementado** | `vision-module/app/mapping/zonas.py` (overlap bbox∩ROI), `confirmacion.py` (sostenido `CONFIRMACION_SEGUNDOS`), `politica.py` (estado destino) | 27 tests en `test_zonas.py`, 11 en `test_confirmacion.py` y 39 en `test_politica.py`. La política nunca escribe `libre`: solo `ocupada` y `pendiente_limpieza` — en 6 de las 8 combinaciones de (observación, estado) no tocar la mesa es el comportamiento correcto. |
| RF-11 Actualización automática del estado | **Implementado** | `vision-module/app/main.py` `aplicar_cambio()` → `PATCH /mesas/{id}/estado`; `mesas.py:169` acepta `ROL_VISION_MODULE` | Aplicación fuera del ciclo con pool de hilos (`AplicadorEnSegundoPlano`, T26-183) para no degradar la cadencia. 73 tests en `test_main.py`, el archivo más cubierto del proyecto. |
| RF-12 Asociación cámara ↔ sector del salón | **Implementado** | `models/camara.py:52` (`sector_id` NOT NULL); `models/roi_mesa.py` + `backend/app/routers/roi.py`; `frontend/src/pages/CalibracionRoiPage.tsx` | La asociación es más fina que lo que pide el RF: además de cámara→sector hay ROI poligonal por **mesa** dentro de cada cámara, con UNIQUE `(mesa_id, camara_id)`. 35 tests en `test_roi.py`. |

### 4. Visualización en tiempo real

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-13 Panel principal de monitoreo | **Implementado** | `frontend/src/pages/DashboardPage.tsx`; e2e `04-canvas-monitoreo.spec.ts` | Refresco automático por polling cada 3 s (`INTERVALO_REFRESCO_MESAS_MS`). |
| RF-14 Visualización por colores/indicadores | **Implementado** | `frontend/src/constants.ts` (`COLOR_POR_ESTADO`, `BORDE_POR_ESTADO`, `ETIQUETA_POR_ESTADO`); `MesaVisual.tsx`; e2e 4.2 | Paleta compartida entre canvas, leyenda y panel de ocupación. |
| RF-15 Filtrado por estado de mesa | **Implementado** | `mesas.py:46` acepta `estado: Optional[EstadoMesa]`; desplegable en `DashboardPage.tsx:28,59`; `mesasApi.listar({ estado })`; e2e `16-filtro-estado.spec.ts` (6 tests) | **Cambió desde la auditoría original**, que lo daba **"Parcial — sin UI"** y lo señalaba como "código sin cobertura *y* sin UI", y como el gap más barato de cerrar del resumen ejecutivo. Hoy el desplegable existe, el filtro **se resuelve en el backend** (verificado por e2e 16.4, que comprueba que no es un recorte en el cliente), se limpia al entrar en modo edición y tiene un atajo "Ver todas". |
| RF-16 Visualización por sectores | **Implementado** | `frontend/src/components/SectorBloque.tsx`; agrupación en `DashboardPage.tsx`; filtro `sector_id` en `/mesas`, `/metricas/*`; e2e 4.1 y 11.4 | |

### 5. Gestión manual de estados

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-17 Cambio manual del estado | **Implementado** | `mesas.py:169` `cambiar_estado_mesa()` (encargado/mozo/admin + vision_module); `frontend/src/components/PanelMesa.tsx`; e2e 4.3, 4.4, 6.1, 6.2 | El origen queda trazado: `origen_de(usuario)` distingue `manual` de `automatico` (`mesas.py:31`). |
| RF-18 Confirmación de mesa limpia | **Implementado** | `mesas.py:188` `limpiar_mesa()` (encargado/limpieza/admin); e2e 15.3 | Devuelve 409 si la mesa no está en `pendiente_limpieza`. 11 tests en `test_limpieza_demorada.py`. |
| RF-19 Marcado manual de mesa reservada | **Implementado** | `mesas.py:205` `reservar_mesa()` (encargado/recepcion/admin); `mesas.reservada_para` (T26-208); e2e `27-reserva-con-hora.spec.ts` | **Cambió desde la auditoría original**, que lo daba implementado pero "sin test dedicado al endpoint `/reserva` en sí". T26-208 sumó la **hora** de la reserva (`reservada_para`, nullable para las reservas ya cargadas) y la marca `ocupacion_detectada_en` para cuando la detección ve gente en una mesa reservada; el spec 27 lo cubre. |

### 6. Historial y métricas operativas

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-20 Registro histórico de cambios | **Implementado** | `models/historial.py`; `mesas.py:45` `registrar_historial()` | Incluye `origen_cambio` (`automatico`/`manual`, T26-163), nullable a propósito para las filas previas. |
| RF-21 Consulta de historial | **Implementado** | `backend/app/routers/historial.py` `listar_historial()` (filtros mesa + rango + orden); `frontend/src/pages/HistorialPage.tsx`; e2e `08-historial.spec.ts` | Valida `fecha_inicio > fecha_fin` con 400. Sigue **sin `test_historial.py`** (ver §4). |
| RF-22 Métricas de ocupación | **Implementado** | `metricas.py:54` `obtener_ocupacion()`; `frontend/src/pages/OcupacionPage.tsx`; e2e `10-ocupacion.spec.ts` | Decisión explícita: `reservada` **no** suma al % de ocupación, verificada en e2e 10.4. Devuelve además `ocupacion_alta` (RF-26) y si el local está en horario de servicio. |
| RF-23 Métrica de rotación | **Implementado** | `metricas.py:129` `obtener_rotacion()`; `frontend/src/pages/RotacionPage.tsx`; e2e `11-rotacion.spec.ts` (6 tests) | Rotación = transición *hacia* `ocupada`, con resolución del estado previo al rango. Recorte por horario de servicio (`services/horario.py`, 25 tests). |
| RF-24 Horarios de mayor demanda | **Implementado** | `metricas.py:286` `obtener_demanda()`; `services/ocupacion.py:160` `calcular_demanda_por_franja()` + `:193` `_repartir_en_franjas()`; `frontend/src/pages/DemandaPage.tsx`; 13 tests en `test_metricas.py`; e2e `21-demanda.spec.ts` (6 tests) | **Cambió desde la auditoría original**, que lo daba **"No encontrado"** con "búsqueda sin resultados en backend, frontend y vision-module". Lo cerró T26-186. "Demanda" se mide como **ocupación media por franja horaria**, no como cantidad de llegadas, y se apoya en la misma reconstrucción de historial que RF-32 en vez de contar filas. **Limitación real y vigente:** el reporte describe bien el método pero el dataset es corto. La mitigación es de presentación, no de datos — `DIAS_MINIMOS_PARA_PATRON = 3` dispara un aviso (e2e 21.4) y la pantalla nunca muestra el porcentaje sin los minutos medidos ni sin decir sobre cuántos días se calculó. No hay script de siembra de datos de demo ni de limpieza de historial en el repo: lo que se ve es lo que haya en la base. |

### 7. Notificaciones y alertas

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-25 Alerta de mesa pendiente de limpieza | **Implementado (alerta visual)** | `configuracion_general.minutos_limpieza_demorada`; `frontend/src/constants.ts:limpiezaDemorada()`; `MesaVisual.tsx`; e2e `15-limpieza-demorada.spec.ts` | Es un **indicador visual en el canvas** cuando se supera el umbral, no una notificación push ni un mail. Apagado por defecto (umbral nullable). Si la defensa entiende "alerta" como notificación activa, esto es parcial. |
| RF-26 Alerta de alta ocupación | **Implementado (alerta visual)** | `configuracion_general.umbral_ocupacion_alta`; `metricas.py:54` devuelve `ocupacion_alta`; banner en `DashboardPage.tsx`; e2e `19-alerta-ocupacion.spec.ts` (4 tests) | T26-187. Mismo alcance que RF-25: **indicador visual**, no notificación activa. A diferencia de RF-25 viene **encendido** por defecto (umbral NOT NULL en 85%); para desactivarlo hay que ponerlo en 100. La comparación la resuelve el backend, así que la UI no reimplementa el criterio. **Corrección de la auditoría original:** su tabla resumen contaba a RF-26 entre los "no encontrado" aunque esta misma fila ya lo daba implementado. Era un error interno del informe, no un cambio de código. |
| RF-27 Alerta por posible error de detección | **Implementado (alerta visual), con un único criterio** | `backend/app/services/estado_dudoso.py`; campo `estado_dudoso` en `GET /mesas/` y `GET /mesas/{id}`; badge en `MesaVisual.tsx:275`; 20 tests en `test_estado_dudoso.py` (incluye tabla de verdad parametrizada); e2e `20-estado-dudoso.spec.ts` (5 tests) | **Cambió desde la auditoría original**, que lo daba **"No encontrado — sin implementación"**. Lo cerró T26-188. El criterio son tres condiciones simultáneas: mesa en `ocupada` **+** con ROI activo en cámara activa **+** fuera del horario de servicio. Con el local cerrado no hay comensal posible, así que una mesa todavía ocupada es inequívocamente un estado colgado, y el corte sale de `hora_cierre` y no de una constante elegida a dedo. **Falta el caso simétrico** —una mesa ocupada por más tiempo del razonable *dentro* del horario— y está **apagado a propósito**, documentado en el propio archivo: ese umbral necesita el p90 de duración real de una ocupación, y el historial disponible es mayormente de la suite e2e. Es una limitación de datos, no de código. |

### 8. Administración del sistema

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-28 Configuración general | **Implementado** | `backend/app/routers/configuracion.py`; `models/configuracion.py`; `frontend/src/pages/ConfiguracionPage.tsx`; e2e `12-configuracion.spec.ts`; 24 tests en `test_configuracion.py` | Fila única (CHECK `id=1`). Cubre nombre, dimensiones, mesas de referencia, horario de servicio, umbral de limpieza, umbral de ocupación alta y —desde T26-172— los **umbrales de detección** (`confirmacion_segundos`, `overlap_minimo`), con CHECKs de rango en la base. |
| RF-29 Configuración de estados | **Descopeado a solo-lectura (decisión cerrada)** | `backend/app/routers/estados.py:1-30` documenta el descope; `test_estados.py` (2 tests); sección informativa en `ConfiguracionPage.tsx:658` | **No es un gap.** `EstadoMesa` es un enum fijo de cuatro valores (`models/mesa.py:12`) y `GET /estados/` solo lo lee. El propio código explica que está hardcodeado en frontend, backend y vision-module y que migrarlo a tabla dinámica era riesgoso a dos sprints del cierre. La pantalla lo dice al usuario con todas las letras: "los estados son fijos, los define el sistema". **Hueco de cobertura:** la sección tiene `data-testid` puestos pero **ningún test e2e los usa**. |
| RF-30 Configuración de cámaras | **Implementado** | `backend/app/routers/camaras.py` (ABM completo, solo admin); `frontend/src/pages/CamarasPage.tsx`; 46 tests en `test_camaras.py` | Contraseñas RTSP cifradas con Fernet (`services/cifrado.py`), con rotación de clave sin downtime. |
| RF-31 Prueba de conexión con cámaras | **Implementado** | `camaras.py:207` `probar_conexion_camara()` y `camaras.py:236` `probar_conexion_url()`; botón "Probar conexión" en `CamarasPage.tsx:225`; vista en vivo MJPEG en `camaras.py:343` + `components/CamaraEnVivo.tsx`; 31 tests en `test_rtsp.py` contra un servidor RTSP falso | **Enriquecido desde la auditoría original**, que registraba los dos endpoints pero no decía si la UI los usaba. T26-203 conectó la prueba a la pantalla y agregó la vista en vivo (`GET /camaras/{id}/stream`), reusada también desde el panel de mesa (`CamaraDeLaMesa.tsx`). **Dos huecos menores:** (a) `POST /camaras/test-conexion` —la variante con la URL en el body, pensada para probar *antes* de dar de alta— existe y está testeada en pytest, pero `ModalAltaCamara.tsx` **no la llama**; (b) ni el botón ni el stream tienen cobertura e2e, y `GET /{id}/stream` no tiene ningún test. |

### 9. Reportes

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| RF-32 Reporte de ocupación diaria | **Implementado** | `metricas.py:211` `obtener_ocupacion_diaria()`; `services/ocupacion.py:133` `calcular_ocupacion_por_mesa()`; `frontend/src/pages/OcupacionDiariaPage.tsx`; 13 tests en `test_metricas.py`; e2e `22-ocupacion-diaria.spec.ts` (5 tests, numerados 16.1–16.5 dentro del archivo) | **Cambió desde la auditoría original**, que lo daba **"No encontrado"** y lo llamaba "el RF de prioridad Media más claramente ausente" (bloqueante 3 del resumen ejecutivo). Lo cerró T26-185. Reconstruye minutos por estado desde `historial_estados` para el **día operativo** de la fecha pedida —no de medianoche a medianoche— resolviendo el caso del turno que cruza las 00:00, y asume `libre` antes del primer evento. No proyecta a futuro: corta en `min(fin, ahora)`. |
| RF-33 Reporte de ocupación por período | **No cumplido** | La pieza reutilizable existe: `services/ocupacion.py:133` `calcular_ocupacion_por_mesa(db, mesas, inicio, fin)` acepta una ventana arbitraria, y su comentario de cabecera (`:6`) dice que se dejó así "porque es la pieza que también necesita RF-33" | **Reclasificado respecto de la auditoría original**, que lo daba **Parcial** apoyándose en que `HistorialPage` y `RotacionPage` tienen rango de fechas. Eso es cierto pero corresponde a RF-21 y RF-23: **no hay ningún endpoint ni pantalla que informe *ocupación* por período.** `GET /metricas/ocupacion` es una foto del instante (solo `sector_id`) y `GET /metricas/ocupacion-diaria` toma **una fecha suelta**, no un rango (`OcupacionDiariaPage.tsx:12` lo aclara a propósito). Llamarlo Parcial sobrestima el estado. **Lo que falta es ensamblaje, no diseño:** la agregación ya acepta rango, `GET /metricas/demanda` ya la usa con `fecha_inicio`/`fecha_fin`, y `components/RangoFechas.tsx` ya está en tres pantallas. Prioridad Baja / Opcional para MVP. |
| RF-34 Exportación de reportes | **Implementado — solo CSV** | `frontend/src/csv.ts`; cuatro pantallas con "Exportar CSV": `HistorialPage.tsx:213`, `RotacionPage.tsx:184`, `OcupacionDiariaPage.tsx:199`, `DemandaPage.tsx:161`; e2e `14-exportar-csv.spec.ts` (3 tests) + el test 16.5 de `22-ocupacion-diaria.spec.ts` | **Ampliado desde la auditoría original**, que registraba solo Historial y Rotación. CSV generado en cliente, calibrado para Excel en español (BOM, `;`, coma decimal, CRLF, fecha dd/mm/aaaa) — `csv.ts:3-6` explica que no hay endpoint de exportación a propósito, para no duplicar la lógica de filtrado. **No hay PDF ni Excel nativo**, y no hay dependencia de ninguno en `package.json`: si la tesis promete "exportación de reportes" sin aclarar formato, conviene decir que el formato es CSV. `OcupacionPage` (la foto del salón) no exporta. **Hueco de cobertura:** el CSV de Demanda es el único de los cuatro sin test. |

### Resumen del punto 1

| Estado | Cantidad | RFs |
|---|---|---|
| Implementado | 32 | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 34 |
| No cumplido | 1 | 33 |
| Descopeado (decisión cerrada) | 1 | 29 |

**Comparación con la auditoría original (2026-09-07):** 24 implementados, 4 parciales (02, 03, 15, 33), 4 no encontrados (24, 26, 27, 32), 1 descopeado. Se cerraron **siete**: RF-02, RF-03, RF-15, RF-24, RF-27 y RF-32 por código nuevo, y RF-26 porque su "no encontrado" era un error de la tabla resumen y no un gap. El único que sigue sin cumplirse es **RF-33**, de prioridad Baja/Opcional.

Dos matices que conviene llevar dichos a la defensa, porque son de redacción del RF y no de código:
- **RF-25, RF-26 y RF-27 son indicadores visuales**, no notificaciones activas (ni push ni mail). Si la tesis entiende "alerta" como notificación, los tres pasan a parciales.
- **RF-27 tiene un solo criterio** de los dos que su enunciado admite, y el segundo está apagado a propósito por falta de datos reales, no por falta de tiempo.

---

## 2. Requerimientos no funcionales (sección 9.2)

> Sin el texto de 9.2 a la vista, cada RNF se evalúa por su nombre. La columna Estado responde: ¿hay código que sostenga la afirmación, o es declaración de intención?

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| Usabilidad | **Respaldo parcial, mejorado** | `components/ErrorBoundary.tsx`; `extraerDetalle()` en `services/api.ts`; `navegacion.ts` como única fuente del menú y los títulos (T26-205); e2e `25-responsive.spec.ts` (11 tests) | **Cambió desde la auditoría original**, que decía "no hay diseño responsive real (el canvas es 1200×700 fijo con `overflow:hidden`)". Hoy el tamaño del salón es configurable, el canvas scrollea de costado (`SalonCanvas.tsx:197`) y hay un spec que verifica que **las ocho pantallas no desbordan en viewport de celular**. **Sin respaldo todavía:** no hay test de accesibilidad ni prueba con usuarios documentada. |
| Rendimiento | **Respaldo fuerte y medido** | `vision-module/app/config.py` (tabla de costo p90 por modelo × resolución, T26-178/179); `registrar_presupuesto()` en `main.py`; `APLICADOR_HILOS` (T26-183); `mesas.estado_desde` denormalizado | Es el RNF mejor sostenido: hay presupuesto explícito (2 s por ciclo), mediciones reproducibles y optimizaciones justificadas por número. **Del lado web no hay medición**: el dashboard hace polling cada 3 s contra Supabase remoto sin presupuesto declarado. |
| Seguridad | **Respaldo fuerte, con huecos conocidos** | bcrypt; JWT 30 min; `requiere_rol()` + matriz en `docs/roles-permisos.md`; rate limit de login (`auth.py:54`); Fernet para credenciales de cámara; CORS por lista explícita; revalidación de `activo` en **cada** request (`auth.py:100`) | Sólido y probado. Esa revalidación por request es lo que hace que la baja lógica de RF-03 corte el acceso al instante y no al vencer el JWT (`test_auth.py::test_desactivar_a_alguien_corta_el_acceso_de_un_token_ya_emitido`). **Huecos:** (a) el rate limit es un dict en memoria — se pierde al reiniciar y no sirve con más de un worker; (b) `User.rol` sin enum ni CHECK; (c) no hay forma de invalidar un token ya emitido salvo desactivando al usuario, que es la razón explícita por la que `PATCH /usuarios/{id}` no rota passwords. |
| Confiabilidad | **Respaldo fuerte** | Reconexión RTSP (`camera.py`), tolerancia a stream muerto, confirmación sostenida antes de escribir (`confirmacion.py`), tope de cola por mesa, 409 en vez de 500 para choques UNIQUE (`database.py:es_violacion_unique`) | 519 tests unitarios y 143 e2e en verde. La confirmación por tiempo es exactamente la defensa contra falsos positivos. |
| Escalabilidad | **Declaración de intención** | — | El sistema asume **un solo local** (`horario.py:TZ_LOCAL`), **una sola cámara por corrida** del módulo (`SECTOR_ID`/`CAMARA_ID`) y **backend single-worker** (el dict `_ultima_deteccion` en `camaras.py` y el rate limit dejan de ser correctos con más de uno). Nada de esto impide la defensa, pero no hay código que sostenga una afirmación de escalabilidad horizontal. |
| Mantenibilidad | **Respaldo fuerte** | Separación por capas (`models`/`schemas`/`routers`/`services`); `vision-module` como proceso independiente; Alembic como única fuente del esquema; `navegacion.ts` y `constants.ts` como fuentes únicas de navegación y paleta; densidad de comentarios explicativos muy alta (el porqué, no el qué) | Cero `TODO`/`FIXME`/`HACK`/`XXX` en todo el código y cero `NotImplementedError` vivos. Es notable y conviene decirlo en la defensa. |
| Disponibilidad | **Respaldo parcial** | `docs/DEPLOYMENT.md` (318 líneas, procedimiento manual de despliegue desde cero); `ErrorBoundary`; reconexión de cámara; fallo silencioso al publicar detección | **Cambió desde la auditoría original**, que decía "**no hay despliegue**: no existe Dockerfile, CI, healthcheck, supervisor ni proceso de arranque automático", y que la disponibilidad dependía de levantar `uvicorn` y `npm run dev` a mano. Hoy existe un manual de despliegue completo y versionado. **Lo que sigue faltando:** Dockerfile, CI, healthcheck y supervisor — el procedimiento está escrito pero es **manual**, no automatizado. |
| Compatibilidad | **Respaldo débil** | `playwright.config.ts` corre **solo** `chromium` | Un único navegador probado. Sin Firefox ni WebKit. El backend es multiplataforma pero `playwright.config.ts` hardcodea `venv/Scripts/python.exe` (ruta Windows). Lo que sí mejoró es la matriz de resoluciones: `25-responsive.spec.ts` cubre escritorio y celular en ocho rutas. |
| Privacidad | **Respaldo fuerte y documentado** | `docs/privacidad-vision.md` (auditoría de escritura de imágenes, ausencia de biometría, tratamiento no diferenciado de personas); `.gitignore` sobre `data/samples/`; enmascarado de contraseña en URLs | El pipeline de producción no persiste imágenes; las excepciones (vista en vivo en memoria, banco de pruebas en disco, video de demostración de T26-204) están documentadas con qué/dónde/activación/retención. **El documento se actualizó parcialmente** desde la auditoría original — ver §6. |

---

## 3. Estado de la base de datos

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| Esquema versionado | **Alembic como única fuente** | `database/versions/` (11 revisiones); `main.py` ya no llama a `create_all` (T26-137) | **Cambió desde la auditoría original**, que contaba 7 revisiones. Se sumaron las de umbrales de detección (`b042ca591eb4`), umbral de ocupación alta (`c17e4a90d3b2`), reserva con hora (`d5f81a20c9e7`) y la siembra de la fila de configuración (`7db753755bb9`). |
| Migraciones documentadas | **Incompleta** | `database/README.md` documenta **4 de 11** | Empeoró en términos relativos: la auditoría original decía 4 de 7. Las revisiones nuevas se agregaron sin tocar la tabla del README. |
| Baja lógica generalizada | **Consistente** | `activa`/`activo` en mesas, sectores, cámaras, ROI y usuarios; `incluir_inactivos`/`incluir_inactivas` en los listados | Desde T26-199 también `DELETE /mesas/{id}` y `DELETE /sectores/{id}` son baja lógica. No existe borrado físico de ninguna entidad, lo que es coherente con que `historial_estados` referencie mesas y usuarios. **Consecuencia operativa:** no hay forma de liberar un email de usuario, cosa que la suite e2e tiene en cuenta explícitamente (ver §4). |

---

## 4. Testing

### Resultados tal como salen

| Suite | Comando | Resultado | Tiempo |
|---|---|---|---|
| Backend (pytest) | `backend/venv/Scripts/python.exe -m pytest -q` | **299 passed, 0 failed, 0 skipped** | 85.1 s |
| vision-module (pytest) | `vision-module/venv/Scripts/python.exe -m pytest -q` | **220 passed, 0 failed, 0 skipped** | 22.9 s |
| E2E (Playwright) | `npx playwright test` | **143 passed, 3 skipped, 0 failed** (146 total, 29 archivos) | 33.3 min |

Total unitario: **519 pruebas en verde**, contra las 368 de la auditoría original (184 + 184). Sumando e2e: **662 pruebas en verde**, contra 430.

El e2e más que duplicó su tamaño (65 → 146 tests) y, como corre en un solo worker contra la base real, el tiempo subió de 10,5 a 33,3 minutos. Vale tenerlo en cuenta antes de la defensa: ya no es una suite que se corra "de paso".

Los 3 skipped son **los mismos tres** de la auditoría original, confirmados con una corrida dirigida a esos specs:

| Test | Motivo del skip | ¿Preocupa? |
|---|---|---|
| 4.5 mesa sin sector asignado | `test.skip(true, ...)` **incondicional**: el modelo exige `sector_id` NOT NULL, no se puede crear una mesa huérfana sin tocar la base a mano | No — es una imposibilidad de diseño, documentada en el propio test |
| 9.1 crear ROI dibujando sobre frame real | Su guarda tiene **dos** condiciones: que no esté activa la cámara de prueba por nombre, o que todas las mesas de su sector ya tengan ROI | **Sí, parcialmente** — sigue siendo el único test que ejercita la calibración de ROI contra hardware real y hoy no corre. **Pero el motivo cambió:** la auditoría original lo atribuía a que "la cámara física de prueba no está activa en la base", y eso ya no se sostiene solo — en esta corrida **sí hay cámara activa y sí hay ROI activo** (los specs 20 y 28.3 pasan, y los dos lo exigen). Lo más probable es que hoy dispare la segunda condición, no la primera. Conviene confirmarlo antes de usarlo como argumento |
| 15.1 sin umbral configurado no se marca ninguna mesa | Hay un umbral cargado en la base y la API no permite borrarlo (`exclude_none`) | Menor, pero delata una limitación real y **vigente**: no se puede apagar `minutos_limpieza_demorada` desde la API una vez cargado |

Distribución del backend por archivo, para ubicar dónde está la cobertura:

| Archivo | Tests | | Archivo | Tests |
|---|---|---|---|---|
| `test_metricas.py` | 57 | | `test_configuracion.py` | 24 |
| `test_camaras.py` | 46 | | `test_estado_dudoso.py` | 20 |
| `test_roi.py` | 35 | | `test_limpieza_demorada.py` | 11 |
| `test_rtsp.py` | 31 | | `test_auth.py` | 8 |
| `test_usuarios.py` | 28 | | `test_mesas.py` / `test_sectores.py` | 6 / 6 |
| `test_horario.py` | 25 | | `test_estados.py` | 2 |

### RFs con cobertura insuficiente

| RF | Cobertura | Detalle |
|---|---|---|
| RF-06 Edición de mesas | **De refilón** | `PATCH /mesas/{id}` no tiene ningún test que lo tenga como sujeto. `test_mesas.py` existe pero está acotado a la baja lógica y la reactivación de T26-199 — su propio encabezado lo aclara. |
| RF-21 Consulta de historial | **Solo e2e** | No existe `test_historial.py`. El router de historial está cubierto únicamente por `08-historial.spec.ts`. |
| RF-29 Configuración de estados | **Backend sí, UI no** | `test_estados.py` cubre el endpoint, pero la sección de la pantalla de configuración tiene `data-testid` sin ningún test e2e que los use. |
| RF-31 Prueba de conexión (UI) | **Backend sí, UI no** | Los dos endpoints tienen 31 tests en `test_rtsp.py`, pero el botón "Probar conexión" y la vista en vivo no tienen e2e, y `GET /camaras/{id}/stream` no tiene ningún test. |
| RF-34 Exportación (Demanda) | **Tres de cuatro** | Los CSV de Historial, Rotación y Ocupación diaria tienen test; el de Demanda no. |

**Cambió desde la auditoría original:** su tabla equivalente listaba RF-03, RF-15, RF-24, RF-27 y RF-32 como **sin ningún test**, porque no estaban implementados. Los cinco hoy tienen cobertura unitaria y e2e.

### Hueco estructural de cobertura unitaria

Se redujo pero **no se cerró**. La auditoría original señalaba que el backend no tenía `test_mesas.py`, `test_sectores.py` ni `test_historial.py`, y que el núcleo de RF-04 a RF-07 y RF-16 a RF-21 dependía solo de e2e. Hoy los dos primeros existen, pero con 6 tests cada uno y acotados a un cambio puntual (la baja lógica de T26-199): **no son el CRUD completo**. `test_historial.py` sigue sin existir.

El riesgo original, entonces, sigue en pie en forma atenuada: un cambio en `mesas.py` puede romper RF-17 y `pytest` seguiría en verde, porque lo que cubre ese flujo es la suite e2e, que corre contra la base real y depende de que Vite y uvicorn levanten.

### Nota de método sobre los e2e de usuarios

El spec `23-usuarios.spec.ts` verifica el **alta feliz contra un POST interceptado** y no creando un usuario de verdad. No es comodidad: como no existe `DELETE /usuarios/{id}` —la baja es lógica a propósito—, un alta real por corrida dejaría una cuenta muerta en la base para siempre. El reparto es explícito: que `register()` cree la fila, hashee la password y rechace el email repetido lo cubre pytest; que la pantalla mande lo que se cargó y cierre el modal solo si anduvo se cubre en e2e. El 400 por email repetido **sí** se provoca de verdad (23.10), porque ese camino no crea ninguna fila. El mismo criterio ya se aplicaba en 23.8 para el 409 del último admin.

---

## 5. Deuda conocida

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| Umbrales de detección hardcodeados en `.env` (T26-172) | **Cerrada** | `configuracion_general.confirmacion_segundos` y `.overlap_minimo` con CHECKs de rango (`models/configuracion.py:22-25,70-71`); migración `b042ca591eb4`; e2e 12.7 verifica que guardar un umbral persiste y avisa que afecta la detección en curso | **Cambió desde la auditoría original**, que la daba "sigue abierta" con trabajo sin mergear en `origin/T26-172-...` y decía que cambiar un umbral exigía editar el `.env` y reiniciar el módulo. La rama se mergeó. |
| `TODO` / `FIXME` / `HACK` / `XXX` | **Ninguno** | Búsqueda de marcadores sobre `backend/app`, `backend/tests`, `frontend/src`, `e2e`, `vision-module` y `database/versions`: **cero marcadores reales**. Cero `NotImplementedError` vivos. | El único match en código propio es `ErrorBoundary.tsx:3`, donde "TODO" es la palabra española en "React desmonta TODO el árbol" — vale aclararlo porque un `grep` ingenuo lo cuenta como deuda y no lo es. Los matches de una búsqueda laxa (`temporal`, `pendiente`, `por ahora`) son prosa explicativa dentro de comentarios que documentan decisiones. Es un dato a favor para la defensa, y ahora es reproducible. |
| Rol `vision_module` de solo lectura sobre `/camaras/` y `/roi-mesa/` | **La corrección del Sprint 6 sigue vigente y protegida por tests** | Permisos declarados **por endpoint**, no en el `APIRouter`: `camaras.py` y `roi.py`. Regresiones en `test_camaras.py` y `test_roi.py`, ambas pasando | Ver matiz abajo. |
| Sin forma de rotar la password de un usuario | **Abierta, por decisión** | `UserAdminUpdate` excluye `password` con el motivo escrito; `auth.py` no tiene versionado de tokens | Un reseteo de password dejaría la credencial vieja usable hasta que el JWT venza (30 min), porque no hay forma de invalidar un token ya emitido salvo desactivar al usuario. Cerrarlo bien pide versionado de tokens; se dejó afuera a propósito en el cierre de RF-03. |

### Matiz sobre el rol `vision_module`

No es literalmente "solo lectura", y conviene decirlo con precisión en la defensa. El rol llega **exactamente** a tres endpoints:

| Endpoint | Verbo | ¿Escribe? |
|---|---|---|
| `/camaras/` | GET | No |
| `/roi-mesa/` | GET | No |
| `/camaras/{id}/deteccion-actual` | **POST** | Sí, pero a un **dict en memoria del proceso**, no al registro de la cámara ni a Supabase |

Todo el resto de `/camaras/*` y `/roi-mesa/*` le devuelve **403**, incluidos `GET /camaras/{id}` y el snapshot. El test `test_vision_module_solo_llega_al_listado_y_a_deteccion_actual` verifica los 403 uno por uno. Por fuera de esos routers, el rol también tiene `PATCH /mesas/{id}/estado`, que es su función principal (RF-11) y es correcto que lo tenga.

La causa raíz del bug original está documentada y neutralizada: el permiso vivía en el `APIRouter`, que no distingue verbos, y por eso el usuario técnico podía dar de alta y borrar cámaras. Hoy el router solo exige estar autenticado y cada endpoint declara su rol, con una advertencia explícita en `camaras.py` sobre el riesgo de agregar un endpoint sin `dependencies=`.

**Salvaguarda nueva (T26-175):** la cuenta de servicio de vision-module **no se puede desactivar** desde `PATCH /usuarios/{id}` — devuelve 409 — porque si se cae, la detección se detiene por completo. Está identificada **por email** y no por rol, a propósito, y la pantalla de usuarios la marca con un ícono y deshabilita el botón. Esto es lo que hace que el nombre sí sea editable y el email no: renombrar la cuenta apagaría la salvaguarda en silencio.

---

## 6. Consistencia documentación ↔ código

### El código tiene funcionalidad que las secciones 8.2 / 8.4 / 9.1 no mencionan

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| ROI poligonal por mesa | **Falta documentar** | `models/roi_mesa.py`, `routers/roi.py`, `CalibracionRoiPage.tsx` | RF-12 solo habla de "asociación entre cámara y sector". El sistema hace bastante más: polígono por mesa, calibración visual sobre frame real, edición de vértices. Es de lo más vistoso del proyecto y no figura en el catálogo. |
| Cifrado de credenciales de cámara | **Falta documentar** | `services/cifrado.py`, `scripts/rotar_clave_camaras.py` | Fernet + rotación de clave sin downtime. Ningún RF lo pide; es una decisión de seguridad propia. |
| Trazabilidad del origen del cambio | **Falta documentar** | `models/historial.py:OrigenCambio`, `mesas.py:31` | Distingue cambios `automatico` vs `manual`. RF-20 solo pide "registro histórico". Habilita medir precisión de la detección. |
| Horario de servicio | **Falta documentar** | `services/horario.py` (25 tests), `configuracion_general.hora_apertura/hora_cierre` | Recorta las métricas a la franja de servicio, incluido el caso 20:00→02:00. No lo pide ningún RF, y sin embargo es de lo que más se apoya: RF-23, RF-24, RF-27 y RF-32 lo usan. |
| Alerta de limpieza demorada | **Parcialmente cubierto** | T26-173, `constants.ts:limpiezaDemorada()` | Encaja en RF-25 pero con umbral configurable, que el RF no menciona. |
| Vista en vivo de detecciones y de cámara | **Falta documentar** | `POST/GET /camaras/{id}/deteccion-actual`, `hooks/useDeteccionActual.ts`; `GET /camaras/{id}/stream` + `CamaraEnVivo.tsx` (T26-203) | Overlay de bounding boxes en tiempo real y reempaquetado RTSP→MJPEG con el token en header (no en query string). Sin RF asociado más allá de RF-31. |
| Hora de reserva y detección pendiente | **Falta documentar** | `mesas.reservada_para`, `mesas.ocupacion_detectada_en` (T26-208); `AvisoReservaDetectada.tsx` | RF-19 solo pide "marcado manual de mesa reservada". El sistema además guarda **para cuándo** y avisa si la detección ve gente en una mesa reservada sin que nadie lo haya resuelto. |
| Exportación CSV calibrada para Excel es-AR | **Cubierto por RF-34, pero sin detalle** | `frontend/src/csv.ts` | El RF dice "exportación de reportes"; el trabajo real (BOM, `;`, coma decimal, CRLF) merece una línea — y conviene aclarar que el formato es CSV y no PDF. |
| Banco de pruebas reproducible de detección | **Falta documentar** | `vision-module/scripts/capturar_muestras.py`, `benchmark_deteccion.py`, `lote_desde_video.py`, `render_demo.py`; `docs/banco-pruebas-vision.md` | Metodología de medición (T26-182) con resultados versionados, más las dos herramientas de T26-204 para la defensa: lote desde un video y render de demo anotado que usa las piezas del pipeline real. Es evidencia metodológica fuerte para una tesis. |
| Soft-delete generalizado | **Falta documentar** | `activa`/`activo` en mesas, sectores, cámaras, ROI y usuarios; `incluir_inactivos` | RF-07 habla de "eliminación o desactivación" solo para mesas; en el sistema es la política general y no admite excepción. |

### Las secciones documentan cosas que el código no tiene

| Ítem | Estado | Evidencia | Observación |
|---|---|---|---|
| `PUT /auth/users/{id}` y `PATCH /auth/users/{id}/deactivate` | **Los paths no existen; la funcionalidad sí** | `docs/roles-permisos.md:189-196`; `auth.py` tiene `/register`, `/login`, `/me`; la gestión vive en `/usuarios/` | **Cambió desde la auditoría original**, que llamaba a esto "la inconsistencia más grave del informe" porque la funcionalidad no existía en ninguna parte. Hoy **sí existe**, bajo `GET /usuarios/` y `PATCH /usuarios/{id}`. Lo que queda por corregir es **solo documental y está acotado**: el Capítulo 2 (bitácora) cita esos dos paths puntuales, que nunca existieron, y marca RF-02/RF-03 como "✓ Completado" en una fecha en la que todavía no lo estaban. Ya no es documentación que afirme algo inexistente, es documentación con el path equivocado y la fecha adelantada. |
| "Procesamiento mediante YOLOv8n" | **Desactualizado** | `config.py:YOLO_MODEL_PATH` → `models/yolov8s.pt`, `imgsz=960` | El default real es **yolov8s**, cambiado por medición (T26-178/179). El enunciado del proyecto y `vision-module/README.md` citan yolov8n. Corregir en la tesis, o explicar el cambio como hallazgo (es defendible y está medido). |
| RF-29 "Configuración de estados disponibles" | **Descopeado — ya cerrado** | `routers/estados.py:1-30` | No es un gap. Solo verificar que la tesis refleje el descope en 8.5. |
| `docs/privacidad-vision.md` §2 | **Corregido** | `privacidad-vision.md:14` ya dice que el pipeline está implementado de punta a punta y que el `NotImplementedError` desapareció | **Cambió desde la auditoría original**, que lo daba desactualizado por afirmar que `main.py` y `zonas.py` elevaban `NotImplementedError` como marcador de trabajo pendiente. |
| `docs/privacidad-vision.md` §3 (activación) | **Sigue desactualizado** | `privacidad-vision.md:36`: "los dos endpoints están siempre activos y protegidos por `requiere_rol(ROL_ADMIN)`, igual que el resto del router de cámaras" | Desde T26-152 el **POST** acepta también `vision_module`. Es el único punto de este documento que la auditoría original señaló y que sigue sin corregirse. De paso, el mismo archivo dice "el módulo completo corre 184 pruebas en verde": hoy son **220**. |
| `docs/roles-permisos.md` | **Casi al día** | Línea 49-50 describe `PATCH /usuarios/{id}` como "rol y baja lógica vía `activo`" | Quedó atrás en un detalle chico tras el cierre de RF-03: el endpoint ahora acepta también `nombre`. El resto del documento (incluida la nota sobre los paths fantasma del Capítulo 2) está correcto. También menciona `esEncargado` entre las funciones de `permisos.ts`, que ya no existe. |
| `database/README.md` tabla de revisiones | **Incompleta** | 4 de 11 documentadas | Empeoró: la auditoría original decía 4 de 7. Faltan, entre otras, las de umbrales de detección, umbral de ocupación alta, reserva con hora y siembra de configuración. |
| Numeración de los specs e2e | **Desalineada en un archivo** | `e2e/tests/22-ocupacion-diaria.spec.ts` numera sus tests `16.1`–`16.5`, y `16-filtro-estado.spec.ts` también usa `16.x` | Dos archivos distintos usan el mismo prefijo de numeración. No afecta la ejecución —Playwright identifica por archivo y título— pero al citar un test en la tesis "16.5" es ambiguo. Conviene renumerar el 22 o citar siempre archivo + título. |
| `docs/fica.pdf` | **Ya no está en el repo** | El archivo no existe | Antes existía con 0 bytes. Cualquier auditoría futura sigue arrancando sin la fuente de verdad del catálogo de RF. |

---

## Resumen ejecutivo

### Lo que se resolvió desde la auditoría original

Seis de los diez puntos del resumen ejecutivo original están cerrados:

1. **RF-02/RF-03** — ya no son "documentación que afirma como terminado algo que no está". La funcionalidad existe y está probada (28 tests unitarios + 13 e2e). Queda una corrección documental acotada en el Capítulo 2: los paths citados (`/auth/users/...`) nunca existieron y los reales son `/usuarios/...`.
2. **RF-32** (reporte de ocupación diaria, prioridad Media) — implementado por T26-185.
3. **RF-15 sin UI** — implementado, con 6 e2e que incluyen la verificación de que el filtro se resuelve en el backend.
4. **T26-172 sin mergear** — mergeado: los umbrales de detección se editan desde la pantalla de configuración.
5. **`docs/privacidad-vision.md` §2** — corregido.
6. **Sin `test_mesas.py` / `test_sectores.py`** — existen, aunque acotados (ver el punto 3 de abajo).

Y, sin estar en la lista original: **RF-24 y RF-27 pasaron de "no encontrado" a implementados**, y **RF-26 nunca fue un gap** — era un error de la tabla resumen del propio informe.

### Lo que sigue abierto

1. **La tesis cita YOLOv8n; el código corre YOLOv8s con imgsz 960.** Está medido y es defendible, pero hay que contarlo, no que lo descubra el tribunal. Es el punto de mayor riesgo que queda.
2. **`docs/privacidad-vision.md` §3 sigue diciendo que los dos endpoints de detección son admin-only**, cuando el POST acepta `vision_module` desde T26-152. Es el documento que respalda el RNF de privacidad y es corrección de una línea.
3. **Cobertura unitaria del núcleo de mesas, sectores e historial.** `test_mesas.py` y `test_sectores.py` existen pero cubren un cambio puntual, no el CRUD; `test_historial.py` no existe. RF-06 y RF-21 dependen de la suite e2e.
4. **RF-33 (ocupación por período)** es el único RF sin cumplir. Prioridad Baja/Opcional, y lo que falta es ensamblaje: la agregación ya acepta rango y `RangoFechas` ya existe.
5. **Despliegue manual.** Hay un manual de 318 líneas, pero no hay Dockerfile, CI, healthcheck ni supervisor.
6. **`database/README.md` documenta 4 de 11 migraciones** y **`docs/fica.pdf` no está en el repo.**
7. **Un solo navegador en e2e** (chromium) y `playwright.config.ts` con ruta de venv de Windows hardcodeada.
8. **La suite e2e tarda 33 minutos** en un solo worker contra la base real. Es consecuencia de haberla duplicado (65 → 146 tests), no un problema en sí, pero conviene correrla con tiempo y no sobre la fecha de defensa.
9. **Huecos de cobertura puntuales:** el botón de prueba de conexión y el stream de cámara (RF-31), la sección de estados de la pantalla de configuración (RF-29) y el CSV de Demanda (RF-34) no tienen e2e.

### A favor, y conviene decirlo

**662 pruebas en verde** —519 unitarias y 143 e2e, contra 430 en la auditoría original—, **cero `TODO`/`FIXME`/`HACK`** en todo el código, cero `NotImplementedError` vivos, base en head sin drift, ninguna rama con trabajo sin mergear, y la corrección de permisos del Sprint 6 vigente y protegida por regresiones. La densidad de comentarios que explican **el porqué** de cada decisión —no el qué— es inusual y es evidencia directa del RNF de mantenibilidad.
