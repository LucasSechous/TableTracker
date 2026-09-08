# Loop de detección y actualización automática de estado (RF-10, RF-11)

El módulo de visión pasa de ser una prueba de concepto de YOLOv8n a un proceso que corre continuo:
lee la cámara y los ROI del sector piloto desde el backend, detecta personas por frame, calcula el
overlap contra cada ROI, confirma la lectura contra un umbral de tiempo sostenido y actualiza el
estado de la mesa por la API.

Corre **fuera del backend**, como proceso independiente. El flujo es lineal:

```
capture → detection → mapping (zonas → confirmacion → politica) → client → API
```

## La configuración del sector piloto vive en el backend

Hasta este ticket el módulo leía el mapa de zonas de un archivo local (`ZONES_FILE`, un
`config/zonas.json` copiado a mano en cada despliegue). Ahora la cámara sale de `GET /camaras/` y
los polígonos de `GET /roi-mesa/`, que son los endpoints que dejó
[T26-125 / camaras-roi.md](camaras-roi.md).

El cambio importa por algo más que quitar un archivo: el ROI que dibuja un admin en la UI es
**el mismo** que consume el pipeline, sin un paso manual de copiado en el medio que pueda quedar
desincronizado. `config/zonas.example.json` sobrevive únicamente como documentación del formato de
`coordenadas`; ya no se carga.

Lo que queda en el `.env` es solo: cuál es el sector piloto, y los secretos que la API no entrega
(la contraseña del stream RTSP).

### Qué tiene que existir para que arranque

El módulo valida el escenario antes de procesar un solo frame, y en cada caso dice qué falta en vez
de fallar más tarde con algo indirecto:

| Condición | Si no se cumple |
|---|---|
| `BACKEND_EMAIL`, `BACKEND_PASSWORD` y `SECTOR_ID` presentes | `ConfiguracionInvalida` nombrando las que faltan |
| `OVERLAP_MINIMO` del `.env` dentro de (0, 1] | `ConfiguracionInvalida` — es una fracción, no un porcentaje. Solo valida el respaldo local; el valor que manda la API se valida del lado del backend (T26-183) |
| El sector tiene al menos una cámara activa | `ConfiguracionInvalida`: registrá una en `/camaras` |
| Si tiene más de una, `CAMARA_ID` desempata | `ConfiguracionInvalida` listando las disponibles |
| La cámara tiene al menos un ROI activo | `ConfiguracionInvalida`: dibujá uno en `/roi-mesa` |
| Al menos un ROI apunta a una mesa activa del sector | `ConfiguracionInvalida` |

**Con varias cámaras activas no se elige una por omisión.** Sería procesar en silencio una parte del
sector, y probablemente no la que el operador cree; es preferible no arrancar y pedir `CAMARA_ID`.

**Los ROI que apuntan a mesas dadas de baja se descartan con el motivo en el log**, no cortan el
arranque. El backend no valida esa referencia al desactivar una mesa (`roi_mesa` no tiene cascada,
ver [camaras-roi.md](camaras-roi.md)), así que un ROI puede quedar apuntando a una mesa que ya no
existe en el sector. Mandarle cambios de estado a una mesa fantasma es peor que ignorarlo.

## Las tres decisiones del pipeline

Están separadas en un módulo cada una, a propósito: son tres preguntas distintas y cada una tiene
su propio criterio de corrección.

### 1. Overlap — `mapping/zonas.py`

Por cada ROI se calcula qué fracción del bounding box de cada persona cae dentro del polígono:

```
overlap = área(bbox ∩ ROI) / área(bbox)
```

Si alguna detección supera `OVERLAP_MINIMO`, la mesa se lee como ocupada **en ese frame**. Desde
T26-183 este umbral no es una constante: lo mantiene `main.CacheUmbrales` actualizado contra
`GET /configuracion` (ver más abajo, "Umbrales editables en caliente").

**Por qué contra el área del bbox y no IoU.** Una persona y una mesa tienen tamaños muy distintos en
el frame: alguien de pie ocupa una fracción del rectángulo de una mesa. El IoU divide por la unión,
así que castigaría a las dos figuras por igual y daría siempre valores cercanos a cero, imposibles
de umbralizar con criterio. Preguntar "qué parte de esta persona está sobre la mesa" da un número
interpretable que además no depende del tamaño con el que se haya dibujado el ROI.

**Cómo se calcula la intersección.** Recorte de polígonos **Sutherland-Hodgman** contra el
rectángulo del bbox, y área por la **fórmula del cordón** (shoelace). El algoritmo exige que el
recortante sea convexo y un rectángulo lo es, así que el resultado es exactamente el polígono de
intersección — sin rasterizar máscaras y sin sumar `shapely` como dependencia. Funciona con
polígonos cóncavos, que es el caso realista de una mesa en L o un ROI dibujado a mano.

**Varias zonas pueden apuntar a la misma mesa** (una mesa en el límite entre dos campos de visión,
caso que `roi_mesa` permite a propósito): alcanza con que una la vea ocupada.

En `LOG_LEVEL=DEBUG` se loguea el overlap de cada mesa en cada frame. Es la herramienta para
calibrar `OVERLAP_MINIMO` contra la cámara real.

### 2. Confirmación por tiempo sostenido — `mapping/confirmacion.py`

La lectura frame a frame es ruidosa: un mozo que pasa al lado, una silla que tapa medio segundo a
quien está sentado, un frame en el que YOLO no llega al umbral de confianza. Escribir cada
oscilación llenaría `historial_estados` de basura y haría parpadear el tablero.

Por eso una observación tiene que repetirse durante `CONFIRMACION_SEGUNDOS` seguidos antes de valer
como cambio. Si se corta antes, el reloj vuelve a cero y el estado confirmado no se toca. El default
es **6 s**, dentro del rango de 5-8 s que pedía el ticket originalmente — hoy es apenas el valor de
arranque si la API no responde, editable desde la pantalla de configuración (T26-183).

Tres detalles que no se deducen del enunciado:

- **Se arranca sin valor confirmado, no en `libre`.** Al levantar el módulo no se sabe nada de la
  mesa; suponerlo llevaría a escribir un cambio inventado apenas se confirma la primera lectura.
- **Un frame perdido no es una mesa vacía.** Sin imagen no se observa nada, así que el reloj se deja
  como está en vez de contar ese frame como "no hay gente".
- **Un fallo de escritura revierte la confirmación** (`revertir()`), para que el próximo frame la
  vuelva a emitir y reintente. Sin eso la mesa quedaría desincronizada hasta que la ocupación
  cambiara de nuevo — que puede ser horas.

### 3. Política de estado — `mapping/politica.py`

La cámara solo sabe si hay o no hay gente. Los cuatro estados del backend no se deducen de eso:
`reservada` la pone recepción y `pendiente_limpieza` lo salda el personal de limpieza. Este es el
único lugar donde se cruzan las dos cosas.

| Observación | Estado actual | Escribe | Por qué |
|---|---|---|---|
| hay gente | `libre` | `ocupada` | llegaron comensales |
| hay gente | `reservada` | `ocupada` | llegó quien había reservado |
| hay gente | `ocupada` | — | ya está |
| hay gente | `pendiente_limpieza` | — | lo más probable es que sea el personal limpiando; marcarla ocupada borraría la tarea abierta |
| vacía | `ocupada` | `pendiente_limpieza` | se fueron, hay que levantarla |
| vacía | `libre` | — | ya está |
| vacía | `reservada` | — | la reserva la gestiona recepción |
| vacía | `pendiente_limpieza` | — | la libera el personal de limpieza |

**El módulo nunca escribe `libre`.** Una mesa vuelve a estar libre cuando alguien la limpia
(`PATCH /mesas/{id}/limpieza`), no cuando se vacía. Es lo que hace que el circuito de limpieza
tenga sentido: si la visión pudiera devolver la mesa a `libre` por su cuenta, la tarea pendiente
desaparecería sola sin que nadie la hiciera.

**El estado actual se relee justo antes de escribir** (`GET /mesas/{id}`), no se cachea. Entre dos
cambios de una misma mesa pasan segundos o minutos en los que un mozo o recepción pudieron tocarla,
y la política tiene que decidirse sobre el estado real.

## Identidad y credenciales

**El módulo se loguea con su propio usuario** (`BACKEND_EMAIL` / `BACKEND_PASSWORD`, el usuario
técnico de T26-129) en vez de llevar un token pegado en el `.env`. El token del backend vence a los
**30 minutos** y este proceso corre todo el servicio: un token estático lo vería expirar en la
primera hora. Un 401 se resuelve reloqueándose una vez y reintentando el pedido, transparente para
el pipeline.

El cliente distingue dos familias de error, y esa distinción es la que decide si el proceso sigue
vivo:

- `CredencialesInvalidas` (401 en el login, o 403 en cualquier pedido) — reintentar no lo arregla.
  Corta el arranque con un mensaje que dice qué revisar.
- `ErrorBackend` (red caída, 5xx, timeout) — se loguea y se sigue con el próximo frame. Un backend
  que se reinicia no debería matar el módulo de visión.

Esa distinción vale **una vez que el pipeline está andando**. En el arranque no hay próximo frame al
que seguir: `main()` atrapa `ErrorBackend` entera —`CredencialesInvalidas` incluida, porque hereda de
ella— y sale por `SystemExit` con `No se puede arrancar: …`. Cualquier motivo por el que la API no
responda al levantar el módulo da el mismo mensaje de una línea y no un traceback (T26-135).

**La contraseña del stream RTSP la pone el módulo, no la API.** `GET /camaras/` devuelve la URL con
la contraseña tapada (`rtsp://admin:***@host:puerto/ruta`), que es una decisión deliberada de
[camaras-roi.md](camaras-roi.md): el secreto no viaja por HTTP. Del backend salen host, puerto, ruta
y usuario —el registro de *qué cámara es*— y la contraseña se completa desde `CAMARA_PASSWORD`.

La URL se reconstruye entera en vez de reemplazar `***` como texto: una contraseña puede traer `@`
o `:`, que partirían la URL en otro lado. Así se percent-encodea una sola vez y en el lugar
correcto. Y nada de lo que se escribe en el log lleva la contraseña en claro — para eso está
`rtsp_url.enmascarar()`, que ante una URL que no puede parsear tapa de más antes que arriesgarse a
filtrar el secreto.

## Robustez del loop

- **Frames nulos.** Se toleran `FRAMES_FALLIDOS_MAXIMOS` seguidos antes de cerrar y reabrir el
  stream; entre intentos de reapertura se espera `RECONEXION_SEGUNDOS`. La reconexión no se rinde:
  una cámara que vuelve a las dos horas se retoma sola.
- **Cadencia real.** El tiempo de inferencia se descuenta del intervalo, para que la cadencia sea
  `FRAME_INTERVAL_SECONDS` y no "el intervalo más lo que tardó YOLO", que se iría corriendo.
- **ROI fuera del frame.** El backend valida que las coordenadas no sean negativas, pero no conoce
  la resolución de la cámara, así que el límite superior se controla acá. Se avisa por log en el
  primer frame: no es fatal —el recorte contra el bbox ignora lo que sobra— pero casi siempre
  significa que el ROI se dibujó sobre un frame de otra resolución y está corrido.

## Umbrales editables en caliente (T26-183)

`OVERLAP_MINIMO` y `CONFIRMACION_SEGUNDOS` son los dos parámetros que más impactan la calidad de la
detección, y son justo los que hay que calibrar contra cada salón: la altura de la cámara, el
tamaño de las mesas y el flujo de gente cambian el número óptimo. Hasta este ticket vivían en el
`.env` y ajustarlos exigía entrar a la máquina, editar el archivo y reiniciar el proceso.

Ahora viven en `configuracion_general` (columnas `confirmacion_segundos` y `overlap_minimo`,
`GET`/`PATCH /configuracion`), se editan desde la pantalla de configuración de admin y el módulo
los lee de la API en vez del `.env`:

- **`main.CacheUmbrales`** guarda el último valor conocido y lo refresca cada
  `CONFIGURACION_REFRESCO_ITERACIONES` iteraciones del loop (15 por default, ~30 s con
  `FRAME_INTERVAL_SECONDS=2`) — no en cada una. Preguntarle a la API en cada frame sumaría una
  llamada HTTP cada `FRAME_INTERVAL_SECONDS` por un dato que rara vez cambia; hacerlo solo al
  arrancar habría obligado a reiniciar el proceso para que un ajuste tenga efecto, que es
  justamente lo que el ticket vino a evitar.
- **Un backend caído no tumba la detección.** Si `GET /configuracion` falla, `CacheUmbrales`
  mantiene el último valor bueno y loguea un `WARNING` — mismo criterio que `aplicar_cambio()` ya
  usa para los cambios de estado. Al arrancar, si la API no responde, `cargar_umbrales_iniciales()`
  cae a los valores del `.env`.
  Cuando un valor cambia efectivamente (al arrancar o durante el loop), sale un `WARNING` con el
  valor anterior y el nuevo: cambiar un umbral en caliente altera la detección en curso sin que
  nadie lo vea venir, así que queda un rastro en el log además del que deja el backend en la
  respuesta del `PATCH`.
- `Confirmador.segundos` se sincroniza con el valor cacheado en cada iteración del `bucle()`, así
  que un cambio de `CONFIRMACION_SEGUNDOS` aplica al instante — no hace falta un `Confirmador`
  nuevo.

Esto cierra, para estos dos parámetros nada más, el mismo problema que sigue abierto para los
ROI (ver "Fuera de alcance" más abajo): los ROI todavía se leen una sola vez al arrancar.

## Configuración

Todas las variables están documentadas en
[vision-module/.env.example](../vision-module/.env.example). Las que definen el comportamiento del
loop:

| Variable | Default | Qué hace |
|---|---|---|
| `SECTOR_ID` | — | Sector piloto. Obligatoria |
| `CAMARA_ID` | — | Solo si el sector tiene más de una cámara activa |
| `CAMARA_PASSWORD` | — | Contraseña del stream; obligatoria si la cámara tiene credenciales |
| `OVERLAP_MINIMO` | `0.30` | Respaldo si `GET /configuracion` no responde al arrancar (T26-183); en operación normal manda el valor de la API |
| `CONFIRMACION_SEGUNDOS` | `6` | Mismo respaldo, para el tiempo sostenido antes de confirmar un cambio |
| `CONFIGURACION_REFRESCO_ITERACIONES` | `15` | Cada cuántas iteraciones del loop se relee `/configuracion` |
| `FRAME_INTERVAL_SECONDS` | `2` | Cadencia de análisis |
| `FRAMES_FALLIDOS_MAXIMOS` | `5` | Frames nulos tolerados antes de reconectar |
| `RECONEXION_SEGUNDOS` | `5` | Espera entre intentos de reapertura |
| `BACKEND_TIMEOUT` | `10` | Timeout de cada pedido a la API |
| `VIDEO_SOURCE` | vacío | **Override de desarrollo** (ver abajo) |

`VIDEO_SOURCE` merece una aclaración: si está definido se procesa esa fuente (webcam, `.mp4`,
imagen) **en lugar** del stream de la cámara registrada, y el módulo lo avisa con un `WARNING` en
cada arranque. En producción va vacío. Existe porque `scripts/test_condiciones.py` lo exige y
porque permite probar el pipeline sin una cámara IP a mano.

## Verificación

**188 pruebas unitarias en verde** (incluidas las de T26-183: `CacheUmbrales`, la caída a los valores
del `.env` cuando la API no responde al arrancar, y el refresco cada N iteraciones dentro del
`bucle()`), más la geometría del overlap contra casos calculados a mano: polígono cóncavo, bbox
degenerado, ROI que no toca el bbox, ROI que lo contiene entero.

**Prueba de punta a punta** con el backend levantado sobre SQLite —sin tocar Supabase— y un frame
real con dos personas, con los ROI diseñados contra los bounding boxes que YOLO devuelve
efectivamente sobre esa imagen:

| Mesa | ROI | Overlap medido | Estado inicial | Resultado |
|---|---|---|---|---|
| 1 | sobre una persona | 0.656 | `libre` | → `ocupada` |
| 2 | esquina sin gente | 0.000 | `ocupada` | → `pendiente_limpieza` |
| 3 | esquina sin gente | 0.000 | `reservada` | sin cambio |

Confirmado a los 3.9 s sostenidos (con `CONFIRMACION_SEGUNDOS=3`), dos registros en
`historial_estados`, y **solo dos `PATCH` en toda la corrida**: el módulo siguió procesando frames
sin reescribir estados que ya estaban bien. La contraseña de la cámara no apareció en el log.

Sobre privacidad, el pipeline mantiene la decisión de diseño de
[privacidad-vision.md](privacidad-vision.md) §3: no persiste frames, imágenes ni video. Las
detecciones se procesan en memoria y se descartan; lo único que se escribe es el estado de la mesa.

## Fuera de alcance (hallazgos, no corregidos acá)

- **Los ROI se leen una sola vez, al arrancar.** Dibujar, mover o dar de baja un ROI en la UI no
  tiene efecto hasta reiniciar el proceso. `Confirmador.olvidar()` está escrito para esa recarga en
  caliente y hoy no lo llama nadie fuera de su prueba. Vale un ticket para releer periódicamente
  `/roi-mesa` y aplicar los cambios sin reiniciar — T26-183 resolvió exactamente este problema para
  `OVERLAP_MINIMO` y `CONFIRMACION_SEGUNDOS` con `main.CacheUmbrales`; el mismo patrón (cache +
  refresco cada N iteraciones + tolerancia a que la API no responda) es reutilizable acá.
- **El usuario del módulo tiene que ser `admin`.** `GET /camaras/` y `GET /roi-mesa/` son solo
  `admin` en todos los verbos ([roles-permisos.md](roles-permisos.md)), así que el proceso corre con
  el rol de mayor privilegio del sistema para hacer dos lecturas y un `PATCH` de estado. Es más
  permiso del que necesita. Lo correcto sería un rol de lectura para visión, o abrir esos dos GET a
  un rol de servicio. Además, [camaras-roi.md](camaras-roi.md) deja constancia de que el usuario
  `vision-module@tabletracker.com` que existe hoy en la base tiene rol `mozo`: **con ese usuario tal
  como está, el módulo recibe 403 al arrancar.**
- **No se probó contra una cámara IP real.** El end-to-end usó `VIDEO_SOURCE`, y ese camino corta
  antes de reconstruir la URL RTSP, así que la ruta cámara-registrada → `CAMARA_PASSWORD` → stream
  está cubierta solo por pruebas unitarias. Falta una corrida contra la cámara del local.
- **Una instancia procesa una sola cámara.** Un sector con varias cámaras necesita un proceso por
  cámara, cada uno con su `CAMARA_ID`. Alcanza para el sector piloto; escalar a todo el local pide
  decidir si se paraleliza dentro del proceso o se orquestan varios.
- **La política no distingue al personal de los comensales.** Una mesa en `pendiente_limpieza` con
  gente encima se deja como está suponiendo que es quien limpia, y una mesa `ocupada` que solo tiene
  a un mozo parado al lado puede sostenerse como ocupada si su bounding box cae dentro del ROI. Los
  bounding boxes son rectángulos alineados a los ejes e incluyen bastante fondo, así que alguien
  parado *junto* a la mesa puede solaparla. El umbral de tiempo sostenido lo mitiga pero no lo
  resuelve.
- **[privacidad-vision.md](privacidad-vision.md) quedó desactualizado.** Describe `app/main.py` y
  `app/detection/zonas.py` como no implementados y elevando `NotImplementedError`, que era cierto en
  el Sprint 5 y ya no lo es (además, `zonas.py` vive en `app/mapping/`). Las conclusiones del
  documento siguen valiendo —el pipeline no persiste imágenes— pero conviene revisarlo.
- **[camaras-roi.md](camaras-roi.md) también.** Su sección "Fuera de alcance" dice que el módulo de
  visión todavía no consume esos endpoints y que sigue leyendo `ZONES_FILE`; este ticket es
  justamente lo que cierra ese punto.
