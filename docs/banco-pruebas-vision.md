# Banco de pruebas de detección — armado y medición

**Proyecto:** TableTracker
**Ticket:** T26-182 (habilita el cierre de T26-178, T26-179 y T26-180)
**Alcance:** procedimiento para armar una escena de prueba representativa, capturar material y comparar configuraciones de detección.

## 1. Por qué existe este documento

Tres tickets de la épica urgente quedaron implementados y configurables pero **sin poder elegir sus valores**: `YOLO_IMGSZ` (T26-178), el modelo (T26-179) y `ANCLAJE_OVERLAP` (T26-180). No es un problema de código: es que no hay contra qué medir.

La cámara del sector piloto (id 5, `Tapo test E2E (T26-134)`) no apunta a ningún salón. Enfoca una esquina de pared con una puerta, vigas de techo y una silla, en modo nocturno infrarrojo. Los tres ROIs cargados son rectángulos dibujados sobre pared, puerta y techo. Se armó para validar la integración RTSP → ROI → API, y para eso sirvió; no es un banco de calibración.

Está medido y es reproducible:

```
python -m scripts.benchmark_deteccion --muestras bench-t26-178 --imgsz 640,960

modelo          imgsz   conf  cobertura  det/frame  ms p90   % presup.
yolov8n.pt        640   0.35       0.0%       0.00    266.0      13.3%
yolov8n.pt        960   0.35       0.0%       0.00    438.0      21.9%
yolov8s.pt        640   0.35       0.0%       0.00    562.0      28.1%
yolov8s.pt        960   0.35       0.0%       0.00    906.0      45.3%
```

Cobertura 0% en las cuatro configuraciones. No hay nada que comparar porque no hay nadie a quien detectar.

## 2. Qué hay que armar (trabajo físico)

No hace falta un salón completo. Alcanza con una maqueta:

- [ ] **Una mesa y dos sillas** dentro del encuadre, a una distancia parecida a la que tendría la cámara en un local real.
- [ ] **Reorientar la cámara** hacia esa escena. El encuadre tiene que incluir la mesa entera y el espacio alrededor, no un primer plano.
- [ ] **Dos condiciones de luz.** El frame actual estaba en infrarrojo blanco y negro; el modo nocturno cambia bastante lo que ve el modelo. Lo calibrado de día no sirve de noche, así que hay que medir las dos.
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

## 4. Recalibrar los ROIs

Con la cámara ya apuntando a la escena definitiva:

1. Entrar a **Calibrar ROI** en la aplicación (admin).
2. Sacar un snapshot nuevo — el que esté cacheado es de la escena vieja.
3. Redibujar los polígonos de las mesas 206, 207 y 208 sobre las mesas de verdad, o darlos de baja y crear los que correspondan a la maqueta.

Un ROI dibujado sobre la escena anterior no se "adapta": son coordenadas en píxeles del frame.

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

Lo que se busca es **cobertura alta con `% presup.` bajo**. Pasarse del 100% degrada la cadencia del bucle en silencio: `esperar_proximo_frame()` deja de dormir y el módulo pasa a correr todo lo rápido que puede, clavando el CPU. Desde T26-181 eso al menos sale como WARNING en el log, pero sigue siendo una configuración inviable.

### Lo que el benchmark NO mide

**Precisión.** No hay etiquetas de verdad: nadie anotó cuántas personas hay en cada frame. Sin eso, una detección de más puede ser un acierto o un falso positivo, y no hay forma de distinguirlos automáticamente. Por eso las columnas dicen "detecciones" y no "recall".

En la práctica: si el lote se armó sabiendo que hay gente en todos los frames, la cobertura se acerca al recall real y sirve para comparar. Pero conviene mirar la tabla junto a los frames, no sola. Más detecciones no es automáticamente mejor.

## 6. Elegir los valores

Con las dos tablas (diurna y nocturna) sobre la mesa:

- **T26-178 / T26-179** — la combinación modelo + `imgsz` con mejor cobertura que entre cómoda en el presupuesto **en las dos condiciones de luz**. Van a `YOLO_MODEL_PATH` y `YOLO_IMGSZ`.
- **T26-180** — correr el mismo lote con `ANCLAJE_OVERLAP=bbox_completo` y con `tercio_inferior`, y comparar cuál asigna mejor las personas sentadas a su mesa. El default se dejó sin cambiar a propósito porque elegirlo sin datos sería a ciegas.

> Ojo con `.env`: pisa los defaults de `config.py`. Si cambiás un valor en `config.py` y no ves diferencia, revisá que `vision-module/.env` no lo tenga seteado explícitamente. Ya pasó.

## 7. Nota sobre las cámaras inactivas

El ticket menciona 19 cámaras de corridas e2e como ruido a limpiar. Se verificó y **no hay nada que hacer**:

- Las cuatro llamadas del frontend a `camarasApi.listar()` usan el default, que es `incluir_inactivas=false`. Ya son invisibles en toda la aplicación.
- Hay 4 filas de `roi_mesa` referenciándolas. Un borrado físico rompería la integridad referencial y además contradiría el criterio de soft-delete que sigue todo el proyecto.

Quedan donde están.
