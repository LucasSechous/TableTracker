# Banco de pruebas de detección — armado y medición

**Proyecto:** TableTracker
**Ticket:** T26-182 (habilita el cierre de T26-178, T26-179 y T26-180)
**Alcance:** procedimiento para armar una escena de prueba representativa, capturar material y comparar configuraciones de detección.

## 1. Por qué existe este documento

Tres tickets de la épica urgente quedaron implementados y configurables pero **sin poder elegir sus valores**: `YOLO_IMGSZ` (T26-178), el modelo (T26-179) y `ANCLAJE_OVERLAP` (T26-180). No era un problema de código: no había contra qué medir.

El banco original no servía. La cámara del sector piloto (id 5, `Tapo test E2E (T26-134)`) enfocaba una esquina de pared con una puerta y vigas de techo, en modo nocturno infrarrojo, y los tres ROIs eran rectángulos dibujados sobre pared, puerta y techo. Se había armado para validar la integración RTSP → ROI → API, y para eso sirvió. Como banco de calibración daba **0% de cobertura en las cuatro configuraciones probadas**: no hay nada que comparar cuando no hay nadie a quien detectar.

El 2026-09-23 se rehizo el banco sobre una escena real (mesa de comedor con sillas, cámara alta en picado, 1920x1080) y se agregaron dos cosas que faltaban para que la medición decida algo:

- **Etiquetas de verdad** (`etiquetas.json` por lote), sin las cuales la cobertura no distingue un acierto de un falso positivo — ver sección 5.
- **`comparar_anclaje.py`**, que automatiza la comparación que la sección 6 pedía hacer a mano.

Los lotes y las tablas viven en `data/samples/` y `scripts/resultados/`, ambos gitignoreados.

## 2. Qué hay que armar (trabajo físico)

No hace falta un salón completo. Alcanza con una maqueta:

- [ ] **Una mesa y dos sillas** dentro del encuadre, a una distancia parecida a la que tendría la cámara en un local real.
- [ ] **Reorientar la cámara** hacia esa escena. El encuadre tiene que incluir la mesa entera y el espacio alrededor, no un primer plano.
- [ ] **Dos condiciones de luz.** El modo nocturno infrarrojo es blanco y negro y cambia bastante lo que ve el modelo. Lo calibrado de día no sirve de noche, así que hay que medir las dos y anotar en el `metadata.json` de cada lote si la cámara estaba o no en modo nocturno.
- [ ] **Personas sentadas y de pie**, cerca y lejos del lente. El caso que importa es el de gente **sentada**: T26-180 no tiene caso de prueba sin eso, porque el bounding box de una persona sentada es alto y con una cámara baja buena parte queda por encima de la mesa en la imagen.

> **Privacidad.** Filmá solo a gente que sepa que está siendo grabada y para qué; con el equipo alcanza. No corresponde grabar clientes reales. El material va a `data/samples/`, que está gitignoreado, y se borra al terminar la calibración. Ver la excepción documentada en [privacidad-vision.md](privacidad-vision.md).

## 3. Capturar el material

Un lote por condición de luz, nunca mezclados: dos escenas distintas en la misma carpeta hacen incomparable la medición.

```bash
cd vision-module

python -m scripts.capturar_muestras --etiqueta salon-diurno \
  --cantidad 40 --intervalo 1.5 \
  --condiciones "luz de día, 2 personas sentadas + 1 de pie al fondo"

python -m scripts.capturar_muestras --etiqueta salon-nocturno-ir \
  --cantidad 40 --intervalo 1.5 \
  --condiciones "modo nocturno infrarrojo, 2 personas sentadas"
```

Cada lote deja un `metadata.json` con resolución, horario y condiciones. El script se niega a escribir sobre una carpeta que ya tenga frames, justamente para que no se mezclen dos escenas.

`--intervalo` no conviene bajarlo mucho: dos frames consecutivos de la misma escena son casi el mismo dato y no agregan variedad al lote.

### El que aprieta enter tiene que ser el que NO está en la mesa

Suena obvio y cuesta dos lotes aprenderlo. Un lote de dos minutos disparado por la misma persona que después tiene que ir a sentarse sale vacío: para cuando llega a la silla, terminó. Las opciones que funcionan son pedirle a quien está en la mesa que avise, o darle el comando a esa persona para que lo corra desde el teléfono. **Mirá el lote antes de medirlo** — una hoja de contacto de los 60 frames lleva diez segundos y evita medir una escena vacía.

### Si el lote sale vacío contra una cámara que anda

El script tolera 20 segundos sin recibir nada antes de cortar, medidos en **tiempo** y no en cantidad de intentos. `read_frame()` no bloquea: devuelve `None` mientras el hilo de drenaje de `Camera` todavía no recibió el primer frame, cosa que con RTSP tarda sus buenos dos o tres segundos. La versión original contaba intentos y agotaba el margen en milisegundos, así que devolvía un lote vacío y parecía una cámara caída.

## 4. Recalibrar los ROIs

Con la cámara ya apuntando a la escena definitiva:

1. Entrar a **Calibrar ROI** en la aplicación (admin).
2. Sacar un snapshot nuevo — el que esté cacheado es de la escena vieja.
3. Redibujar los polígonos sobre las mesas de verdad, o darlos de baja y crear los que correspondan a la maqueta.

Un ROI dibujado sobre la escena anterior no se "adapta": son coordenadas en píxeles del frame. Si la cámara se mueve, aunque sea para mejorar el encuadre, **los ROIs y los lotes anteriores dejan de valer**. Conviene dejar la cámara quieta antes de empezar a capturar, no durante.

Una maqueta con una sola mesa alcanza para medir detección, pero no para medir asignación: con un único ROI activo toda persona detectada cae necesariamente en la mesa correcta. Para que la asignación sea discriminante hacen falta al menos dos zonas — partir una mesa larga por la mitad y tratar cada lado como una mesa distinta funciona bien, y tiene la ventaja de que se puede dejar un lado vacío a propósito.

> **Verificá el polígono contra un frame, no contra el canvas.** Superponer las coordenadas que devuelve `GET /roi-mesa/` sobre un frame recién capturado es la única forma de confirmar que el ROI cayó donde se creía. Un polígono puede verse perfecto en la pantalla de calibración y estar corrido si el snapshot era viejo.

> **La IP de la cámara cambia.** Con DHCP, la `rtsp_url` registrada queda apuntando a una IP que ya no es la de la cámara y el módulo no puede abrir el stream. Si la captura falla, comparar la IP registrada contra la real antes de buscar el problema en otro lado. Se corrige con `PATCH /camaras/{id}` mandando la URL entera — mandar la URL implica mandar la contraseña, no se puede editar solo el host.

## 5. Medir

```bash
python -m scripts.benchmark_deteccion --muestras salon-diurno \
  --modelos yolov8n.pt,yolov8s.pt --imgsz 640,960,1280 --confianza 0.25,0.35,0.5
```

### Cómo leer la tabla

| Columna | Qué dice |
| --- | --- |
| `cobertura` | En qué porcentaje de frames encontró al menos una persona |
| `det/frame` | Cuántas personas encontró en promedio |
| `conf.media` | Qué tan segura estaba de sus detecciones |
| `ms p90` | El mal rato, no el caso típico |
| `% presup.` | Ese p90 contra `FRAME_INTERVAL_SECONDS` |
| `recall` | De los frames con gente, en cuántos encontró algo (se satura, ver abajo) |
| `precision` | De los frames donde dijo que había, en cuántos había |
| `conteo ok` | En cuántos encontró **exactamente** la gente que había |
| `FP` / `FN` | Frames vacíos donde dijo que había / frames con gente que se le pasaron enteros |

Lo que se busca es **`conteo ok` alto con `% presup.` bajo y `FP` en cero**. Pasarse del 100% del presupuesto degrada la cadencia del bucle en silencio: `esperar_proximo_frame()` deja de dormir y el módulo pasa a correr todo lo rápido que puede, clavando el CPU. Desde T26-181 eso al menos sale como WARNING en el log, pero sigue siendo una configuración inviable.

> **Las latencias varían bastante entre corridas.** La misma configuración dio 120 ms y 420 ms de media en dos corridas del mismo lote, según qué más estuviera usando el CPU. Comparar dentro de una corrida, no entre corridas, y no medir nada pesado en paralelo.

### Etiquetar el lote: sin esto la tabla miente

**La cobertura tiene techo.** Si 21 de 60 frames están vacíos, el máximo alcanzable es 65%, y una configuración que marque 100% no está viendo más gente: la está **inventando**. Esto no es teórico — en el primer lote del deck, la fila que parecía ganadora (`yolov8s` @ 640, conf 0.25, 100% de cobertura) resultó tener 65% de precisión y 21 frames de falsos positivos, mientras que `yolov8n` @ 960 llegaba al techo exacto con cero.

Para distinguirlos hay que anotar el lote a mano. Un `etiquetas.json` al lado de los frames:

```json
{
  "lote": "comedor-diurno",
  "metodo": "Conteo visual sobre hojas de contacto de los 60 frames.",
  "frames_totales": 60,
  "frames_con_gente": 60,
  "personas_totales": 60,
  "cobertura_maxima_pct": 100.0,
  "personas_por_frame": { "frame_000.jpg": 1, "frame_001.jpg": 1 }
}
```

Con ese archivo presente, la tabla suma cinco columnas: `recall`, `precision`, **`conteo ok`**, `FP` y `FN`. Sin el archivo se comporta como antes.

**`conteo ok` es la columna que decide.** El `recall` se satura y no sirve para elegir: mide presencia, así que con dos personas sentadas encontrar a una sola ya cuenta como acierto. En el lote de la terraza dio **100% en las 27 configuraciones**, incluida una que solo acertaba el conteo en el 35% de los frames. `conteo ok` mide en qué porcentaje de frames encontró **exactamente** la gente que había, y ahí las configuraciones se separan de 35% a 98%.

**Se evalúa a nivel frame, no por persona.** Las etiquetas dicen cuánta gente hay, no dónde, así que emparejar cada detección con una persona sería inventar una correspondencia. Un frame con dos personas donde el modelo encuentra dos cuenta como acierto aunque las cajas estén sobre la gente equivocada — con dos personas en la escena eso es improbable, pero conviene saberlo.

> **Anotá sobre el frame completo, no sobre la hoja de contacto.** A 384 px una persona entrando por el borde del cuadro no se ve, y el conteo sale mal. Pasó: dos frames quedaron etiquetados con una persona cuando tenían dos, y se detectó porque cuatro configuraciones distintas coincidieron en encontrar la segunda. **Toda discrepancia entre etiqueta y detección hay que mirarla a resolución completa antes de asumir que el modelo se equivocó** — la mitad de las veces el error está en la etiqueta.

**Conviene un lote de cada tipo.** Uno con gente en todos los frames mide recall; uno vacío mide falsos positivos. Un lote mixto mide las dos cosas pero con menos frames para cada una.

## 6. Elegir los valores

Con las dos tablas (diurna y nocturna) sobre la mesa:

- **T26-178 / T26-179** — la combinación modelo + `imgsz` con mejor **recall y precisión** que entre cómoda en el presupuesto **en las dos condiciones de luz**. Van a `YOLO_MODEL_PATH` y `YOLO_IMGSZ`. Ojo con elegir por cobertura sola: ver la sección anterior.
- **T26-180** — el anclaje se compara con su propio script, que corre la detección una sola vez y evalúa los dos criterios sobre las mismas cajas:

  ```bash
  python -m scripts.comparar_anclaje --muestras comedor-diurno
  ```

  La columna que manda es **`sin mesa`**: personas detectadas que no cayeron en ningún ROI, o sea una mesa que se va a reportar libre estando ocupada. Entre dos anclajes parecidos gana el que deja menos gente huérfana sin inventar ocupación donde no la hay.

  Conviene armar el lote de modo que **una mesa quede vacía a propósito**: toda ocupación que el script le asigne es una asignación cruzada, y es el error que más ensucia el tablero.

> **La geometría de la cámara cambia el resultado.** El razonamiento de T26-180 es que con una cámara **baja** buena parte del bbox de alguien sentado queda por encima de la mesa en la imagen, y por eso el tercio inferior debería portarse mejor. Con una cámara **alta en picado** esa premisa no aplica: lo medido en un banco en picado no se puede extrapolar a un salón con la cámara a la altura de las mesas. Anotá en qué geometría se midió.

> Ojo con `.env`: pisa los defaults de `config.py`. Si cambiás un valor en `config.py` y no ves diferencia, revisá que `vision-module/.env` no lo tenga seteado explícitamente. Ya pasó.

## 7. Trabajar desde archivos de video

Un video sirve igual que una captura en vivo, y tiene la ventaja de que la escena queda fija: se puede volver a medir cuando se quiera.

```bash
python -m scripts.lote_desde_video --video data/videos/salon.mp4 \
  --etiqueta salon-almuerzo --cada-segundos 2 \
  --condiciones "hora pico, 3 mesas ocupadas"
```

Muestrea un frame cada N segundos **de tiempo de video**, no cada N frames, para que un lote sacado de un video de 25 fps y otro de uno de 30 fps sean comparables. De ahí en adelante es un lote como cualquier otro: se etiqueta y se mide igual.

> **El video tiene que ser del mismo encuadre que los ROI.** Son coordenadas en píxeles: un video de otra cámara, otro ángulo u otro zoom necesita ROI propios.

### Video de demostración

```bash
python -m scripts.render_demo --video data/videos/salon.mp4 --salida demo.mp4 \
  --guardar-rois data/videos/rois.json
```

Genera un MP4 con los ROI coloreados por estado, las detecciones y un panel con el estado de cada mesa y la cuenta regresiva de lo que se está confirmando. Usa las piezas reales del pipeline —`resolver_ocupacion`, `Confirmador`, `estado_objetivo`—, así que lo que se ve es lo que el módulo haría; lo único que no hace es escribir en el backend.

Dos detalles que lo hacen fiel:

- **El reloj del `Confirmador` es el tiempo del video**, no el de pared. `CONFIRMACION_SEGUNDOS` se comporta igual que en vivo, y se ve lo que más cuesta mostrar en una demo en vivo: que alguien que pasa caminando **no** marca la mesa como ocupada.
- **La detección corre a la cadencia real** (una vez cada `FRAME_INTERVAL_SECONDS` de video) pero se dibuja sobre todos los frames. Emitir un frame por inferencia daría un video a los tirones y treinta veces más corto.

`--guardar-rois` deja los ROI en un JSON para poder re-renderizar con `--rois` sin backend. Conviene usarlo: el día de la defensa no querés depender de que la base esté despierta.

> **Privacidad.** El video se proyecta ante gente ajena al proyecto, que es la exposición más fuerte de todo el material del banco. Tiene su propia excepción documentada con condiciones en [privacidad-vision.md](privacidad-vision.md) — leerlas antes de grabar, no después.

## 8. Nota sobre las cámaras inactivas

El ticket menciona 19 cámaras de corridas e2e como ruido a limpiar. Se verificó y **no hay nada que hacer**:

- Las cuatro llamadas del frontend a `camarasApi.listar()` usan el default, que es `incluir_inactivas=false`. Ya son invisibles en toda la aplicación.
- Hay 4 filas de `roi_mesa` referenciándolas. Un borrado físico rompería la integridad referencial y además contradiría el criterio de soft-delete que sigue todo el proyecto.

Quedan donde están.
