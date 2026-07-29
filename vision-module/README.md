# TableTracker — Vision Module

Módulo de visión por computadora del proyecto. Corre **fuera del backend**, como
proceso independiente: toma frames de una cámara, detecta personas con YOLO,
decide el estado de cada mesa según las zonas configuradas y se lo informa a la
API de TableTracker.

Cubre las RF-08 (detección de ocupación) y RF-09 (actualización automática de
estados). Formaliza la prueba de concepto de YOLO (T26-93), que hasta ahora vivía
en una carpeta de pruebas aislada.

## Estructura

```
vision-module/
├── app/                     # Código del módulo
│   ├── config.py            # Lectura centralizada de variables de entorno
│   ├── main.py              # Punto de entrada del pipeline
│   ├── capture/             # Captura de frames (webcam, archivo o RTSP)
│   ├── detection/           # Wrapper de YOLO: frame -> detecciones
│   ├── mapping/             # Zonas (ROI) por mesa: detecciones -> estado
│   ├── client/              # Cliente HTTP hacia la API de TableTracker
│   └── utils/               # Logging y utilidades compartidas
├── config/                  # Configuración de despliegue (mapa de zonas)
├── models/                  # Pesos YOLO (.pt) — no se versionan
├── data/samples/            # Videos/imágenes de prueba — no se versionan
└── tests/                   # Pruebas del módulo
```

El flujo previsto es lineal:

```
capture → detection → mapping → client → API backend
```

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

## Configuración

Las variables se documentan en [.env.example](.env.example). El mapa de zonas
(qué región del frame corresponde a qué mesa) se define en un JSON aparte;
ver [config/zonas.example.json](config/zonas.example.json).

## Estado

Esqueleto de estructura. Los módulos están definidos con su responsabilidad y
firma, pendientes de implementación en los tickets siguientes del Sprint 5.
