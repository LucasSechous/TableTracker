# TableTracker — Vision Module

Módulo de visión por computadora del proyecto. Corre **fuera del backend**, como
proceso independiente: toma frames de una cámara, detecta personas con YOLO,
decide el estado de cada mesa según los ROI configurados y se lo informa a la
API de TableTracker.

Cubre las RF-10 (detección de ocupación) y RF-11 (actualización automática de
estados). Formaliza la prueba de concepto de YOLO (T26-93), que hasta ahora vivía
en una carpeta de pruebas aislada.

## Estructura

```
vision-module/
├── app/                     # Código del módulo
│   ├── config.py            # Lectura centralizada de variables de entorno
│   ├── main.py              # Bucle del pipeline y armado de la corrida
│   ├── capture/             # Captura de frames (webcam, archivo o RTSP)
│   ├── detection/           # Wrapper de YOLO: frame -> detecciones
│   ├── mapping/             # Detecciones -> estado de cada mesa
│   │   ├── zonas.py         #   overlap entre bounding boxes y ROI
│   │   ├── confirmacion.py  #   umbral de tiempo sostenido
│   │   └── politica.py      #   qué estado se escribe según el actual
│   ├── client/              # Cliente HTTP hacia la API de TableTracker
│   └── utils/               # Logging, URL RTSP y utilidades compartidas
├── config/                  # zonas.example.json: formato de los ROI, de referencia
├── models/                  # Pesos YOLO (.pt) — no se versionan
├── data/samples/            # Videos/imágenes de prueba — no se versionan
└── tests/                   # Pruebas del módulo
```

El flujo es lineal:

```
capture → detection → mapping (zonas → confirmacion → politica) → client → API backend
```

## Cómo decide el estado de una mesa

1. **Overlap.** Por cada frame se calcula, para cada ROI, qué fracción del
   bounding box de cada persona cae dentro del polígono (`área(∩)/área(bbox)`).
   Si alguna supera `OVERLAP_MINIMO`, la mesa se lee como ocupada en ese frame.
   Se mide contra el área del bbox y no como IoU porque una persona y una mesa
   tienen tamaños muy distintos y el IoU daría siempre valores cercanos a cero.
2. **Confirmación.** Esa lectura tiene que sostenerse `CONFIRMACION_SEGUNDOS`
   seguidos para valer como cambio. Si se corta antes, el reloj vuelve a cero:
   así alguien que pasa caminando no ocupa la mesa. Un frame perdido no cuenta
   como mesa vacía, simplemente no se observa nada.
3. **Política.** Recién ahí se cruza con el estado actual de la mesa, que se
   relee del backend justo antes de escribir:

   | Observación | Estado actual | Escribe |
   |---|---|---|
   | hay gente | `libre` | `ocupada` |
   | hay gente | `reservada` | `ocupada` |
   | vacía | `ocupada` | `pendiente_limpieza` |
   | *cualquiera* | el resto | *no toca la mesa* |

   El módulo **nunca escribe `libre`**: una mesa vuelve a estar libre cuando
   alguien la limpia (`PATCH /mesas/{id}/limpieza`), no cuando se vacía.

Ver [docs/vision-loop.md](../docs/vision-loop.md) para el detalle de las
decisiones y sus límites conocidos.

## Puesta en marcha

Desde `vision-module/`:

```bash
python -m venv venv
venv\Scripts\activate          # Windows;  en Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env         # Linux/macOS: cp .env.example .env
python -m app.main
```

`ultralytics` instala `torch` en su versión CPU. Para usar GPU hay que instalar
`torch` aparte desde el índice de PyTorch correspondiente a la versión de CUDA.

Los pesos del modelo (`models/*.pt`) no están versionados: se descargan la
primera vez que se ejecuta el módulo o se copian manualmente a `models/`.

### Qué tiene que existir en el backend

El módulo no arranca si el sector piloto no está armado, y en cada caso dice qué
falta:

- un **sector** (`SECTOR_ID`) con al menos una **cámara activa**; si tiene más de
  una hay que elegir cuál con `CAMARA_ID`;
- al menos un **ROI activo** de esa cámara (`POST /roi-mesa/`) apuntando a una
  mesa activa del sector;
- un **usuario** (`BACKEND_EMAIL` / `BACKEND_PASSWORD`) cuyo rol pueda leer
  `/camaras` y `/roi-mesa` —hoy **solo `admin`**— y cambiar el estado de las mesas.

## Configuración

Las variables se documentan en [.env.example](.env.example). Dos que conviene
tener presentes:

- **`CAMARA_PASSWORD`**: la API devuelve la URL RTSP con la contraseña tapada
  (`rtsp://admin:***@...`) por diseño, así que el módulo la completa desde el
  `.env`. Del backend salen host, puerto, ruta y usuario; el secreto no viaja
  por HTTP ni se escribe en el log.
- **`VIDEO_SOURCE`**: override de desarrollo. Si está definido se procesa esa
  fuente (webcam, `.mp4`, imagen) en lugar del stream de la cámara registrada, y
  el módulo lo avisa al arrancar. En producción va vacío.

Para calibrar `OVERLAP_MINIMO` contra la cámara del local, correr con
`LOG_LEVEL=DEBUG`: se loguea el overlap máximo de cada mesa en cada frame.

## Pruebas

```bash
venv\Scripts\python -m pytest
```

Las pruebas no necesitan backend, cámara ni pesos de YOLO: la API se mockea y el
reloj de confirmación se inyecta como argumento.
