# Resultados de las pruebas de captura y detección — Sprint 5

**Proyecto:** TableTracker
**Ticket:** T26-104 (continúa el criterio aplicado en T26-95, Sprint 4)
**Alcance:** Sprint 5 — validación inicial de `app/capture/camera.py` + `app/detection/detector.py`, en preparación para la integración completa del módulo de IA en Sprint 6 (RF-10, RF-11, RF-12).

## 1. Objetivo

Registrar de forma clara qué funcionó y qué no en la captura y detección inicial, para que Sprint 6 arranque con expectativas realistas sobre la precisión y el comportamiento del pipeline en condiciones reales.

## 2. Metodología

Se desarrolló un script de prueba (`vision-module/scripts/test_condiciones.py`) que reutiliza los componentes ya implementados de captura (`Camera`) y detección (`Detector`) sin modificarlos, procesando frames durante una duración configurable y registrando, por cada frame, la clase detectada, la confianza y la cantidad total de detecciones. Al finalizar cada corrida, el script genera un resumen en JSON con la fuente utilizada, la duración real, la cantidad de frames procesados, estadísticas de confianza por clase y la proporción de frames sin ninguna detección.

Cada corrida se etiquetó con una descripción de las condiciones bajo las que se ejecutó (presencia o ausencia de personas en el encuadre, fuente de video), a partir de una primera corrida de control ambigua que evidenció la necesidad de este registro (ver sección 4).

**Fuentes evaluadas:**
- Webcam local (dispositivo integrado de la notebook).
- Cámara IP TP-Link Tapo C310, vía RTSP (`stream1`, alta calidad).

**Configuración del modelo:** YOLOv8n, `YOLO_CONFIDENCE=0.5`, `YOLO_CLASSES=0` (únicamente la clase `person` de COCO). El filtro de clases significa que el pipeline, en esta etapa, solo evalúa la presencia de personas — no se probó la detección de mesas ni sillas, ya que el criterio de ocupación previsto para el MVP se basa en presencia humana dentro de la zona de la mesa, no en el reconocimiento del mobiliario en sí.

## 3. Resultados

| Corrida | Frames | Sin detección | % sin detección | Confianza `person` (prom. / rango) | FPS promedio* |
| --- | --- | --- | --- | --- | --- |
| Webcam + persona | 17 | 0 | 0% | 0.874 (0.82–0.92) | 1.53 |
| Webcam + vacío | 60 | 60 | 100% | — | 5.76 |
| RTSP (Tapo) + persona | 93 | 0 | 0% | 0.894 (0.83–0.93) | 7.51 |
| RTSP (Tapo) + vacío | 92 | 92 | 100% | — | 7.63 |

*El FPS reportado corresponde a la velocidad de captura + inferencia sin límite artificial, y **no representa el throughput del pipeline en producción**: el módulo real (`main.py`, a implementar en Sprint 6) procesará frames a la cadencia configurada en `FRAME_INTERVAL_SECONDS` (2 segundos por defecto), no a la velocidad máxima de la cámara.

### 3.1 Precisión de detección

Con una persona presente en el encuadre, ambas fuentes detectaron correctamente en el 100% de los frames procesados, con niveles de confianza altos y consistentes (0.874 en webcam, 0.894 en RTSP). No se observó diferencia relevante en confianza entre fuentes bajo buena visibilidad.

Con el encuadre vacío, ambas fuentes registraron 0% de falsos positivos en la corrida final validada (ver limitación metodológica en la sección 4 sobre una corrida de control anterior descartada).

### 3.2 Diferencia de throughput entre fuentes

Se observó una variación notable en FPS dentro de la propia webcam entre la corrida con persona (1.53 fps) y la corrida vacía (5.76 fps), una diferencia de casi 4×. La cámara RTSP, en cambio, se mantuvo estable entre ambas condiciones (7.51 y 7.63 fps). La causa más probable es un comportamiento de autoenfoque o autoexposición de la webcam que se ajusta al detectar una persona, aunque no puede descartarse que se trate de ruido estadístico dado el tamaño reducido de la muestra (17 y 60 frames respectivamente). Queda como punto a investigar si el throughput real de la webcam resulta relevante para una futura implementación.

## 4. Limitaciones metodológicas

- **Muestra reducida por corrida** (17 a 93 frames): suficiente para una prueba de humo que confirme el funcionamiento básico del pipeline, pero insuficiente para conclusiones estadísticamente sólidas sobre tasas de confianza o de falsos positivos/negativos.
- **Corrida de control inicial descartada:** una primera prueba de control sin metadata de condiciones registró detecciones de `person` en 4 de 14 frames pese a estar etiquetada como "sin nadie en el encuadre", con confianza comparable a la de una detección real (hasta 0.90). No fue posible determinar con los datos disponibles si se trató de un falso positivo genuino del modelo o de una persona u objeto efectivamente presente en el encuadre sin haber sido confirmado visualmente. A partir de este hallazgo se agregó al script el parámetro `--condiciones`, para registrar explícitamente el contexto de cada corrida en el JSON de resultados en vez de depender de la memoria de quien ejecuta la prueba. Las corridas de control repetidas con verificación visual directa (sección 3) no reprodujeron el problema.
- **El script no aplica `FRAME_INTERVAL_SECONDS`:** mide la capacidad cruda de captura + inferencia, no el comportamiento del pipeline de producción, que procesará frames a una cadencia mucho menor. Los valores de FPS de esta sección no deben interpretarse como representativos del rendimiento final del sistema.
- **Condiciones de iluminación y ángulo:** las corridas documentadas en este informe se realizaron en un único entorno (luz natural de interior, ángulo frontal fijo por cámara). No se evaluaron variaciones sistemáticas de iluminación (nocturna, contraluz) ni de ángulo/distancia de cámara, quedando como trabajo pendiente para una validación más exhaustiva antes de Sprint 6, en caso de considerarse necesario.

## 5. Conclusiones y recomendaciones para Sprint 6

- La detección de personas mediante YOLOv8n resulta confiable en condiciones de buena visibilidad, con confianza consistentemente superior a 0.82 en ambas fuentes evaluadas, lo que respalda su uso como base para la resolución de estado de mesas (ocupada/libre) prevista en RF-10.
- No se detectó una diferencia significativa de precisión entre la webcam y la cámara Tapo C310 bajo las condiciones probadas, por lo que ambas resultan viables como fuente para la validación del MVP en entorno controlado.
- La diferencia de throughput observada en la webcam amerita una revisión puntual si en algún momento el rendimiento en tiempo real se vuelve un requisito crítico, aunque no bloquea el avance a Sprint 6 dado que el pipeline de producción operará a una cadencia fija, no a la velocidad máxima de captura.
- Se recomienda, antes de dar por cerrada la validación del módulo de detección, ampliar las pruebas a condiciones de iluminación variable y distintos ángulos/distancias de cámara, dado que las corridas de este informe cubrieron un único escenario de buena visibilidad.
