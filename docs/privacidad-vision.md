# Consideraciones de privacidad aplicadas al módulo de visión por computadora

**Proyecto:** TableTracker
**Referencia normativa:** Anteproyecto de Tesis, secciones 9.2 (Requerimientos no funcionales — Privacidad y uso de imágenes), 13.6 (Riesgos de privacidad) y 14.4 (Factibilidad legal y de privacidad).
**Alcance:** Sprint 5 — módulo `vision-module`.
**Última revisión:** Sprint 5, previo a la implementación de `app/main.py` y `app/detection/zonas.py`.

## 1. Objetivo

Este documento deja constancia de cómo el módulo de visión por computadora de TableTracker cumple, en su estado actual de implementación, con los principios de privacidad establecidos en el anteproyecto: evitar la identificación de personas y priorizar el almacenamiento de estados por sobre el almacenamiento de material visual.

## 2. Estado actual del pipeline

A la fecha de esta revisión, los componentes de captura (`app/capture/camera.py`) y detección (`app/detection/detector.py`) están implementados y probados de forma unitaria, pero el flujo que los conecta de punta a punta (`app/main.py`) y el mapeo de detecciones a zonas/mesas (`app/detection/zonas.py`) aún no están implementados; ambos elevan `NotImplementedError` de forma explícita como marcador de trabajo pendiente. En consecuencia, no existe hoy un pipeline en ejecución continua sobre el cual auditar comportamiento en producción, y las verificaciones de este documento se basan en una revisión directa del código fuente de cada componente ya construido.

## 3. Verificación: almacenamiento de imágenes y video

Se realizó una búsqueda exhaustiva de operaciones de escritura de archivos multimedia (`imwrite`, `VideoWriter`, el parámetro `save=True` de Ultralytics, y escritura binaria genérica) en todo el código de `vision-module/`.

No se encontraron dichas operaciones en el código de producción. La única ocurrencia detectada corresponde a un fixture de pruebas (`tests/test_camera.py`), que genera una imagen sintética en un directorio temporal de pytest, descartado automáticamente al finalizar la ejecución de la prueba. Esta ocurrencia es infraestructura de testing y no forma parte del comportamiento del sistema en uso real.

Tanto la captura de frames (`Camera.read_frame`) como la detección (`Detector.detect`) operan exclusivamente en memoria: reciben, procesan y devuelven datos sin persistirlos en disco en ningún punto.

**Conclusión:** el módulo, tal como está implementado a la fecha, no guarda frames, imágenes ni video en disco. Las detecciones se procesan en memoria y se descartan una vez evaluadas.

Esta situación responde en parte al estado incompleto del pipeline (sección 2) y no debe interpretarse todavía como una garantía permanente. Se establece como **decisión de diseño explícita para lo que resta del Sprint 5**: al implementar `main.py` y `zonas.py`, el pipeline completo deberá mantener este mismo comportamiento —no persistir imágenes ni video— salvo que una necesidad justificada de evidencia puntual (por ejemplo, para depuración durante pruebas controladas) requiera lo contrario, en cuyo caso dicha excepción deberá quedar documentada aquí mismo, indicando ubicación, condición de activación y criterio de retención antes de integrarse al código.

### Excepción documentada: vista en vivo de detecciones (T26-150)

**Qué se persiste.** El último resultado de detección de cada cámara —los bounding boxes, la clase y la confianza de cada detección del frame, más el timestamp de captura (`DetectionFrameResult`, el contrato de `vision-module/schemas/detection_output.py` escrito en este mismo Sprint 5)— deja de descartarse apenas se evalúa y queda disponible un momento más. No es un dato nuevo: es exactamente el mismo resultado que el pipeline ya calculaba y tiraba (sección 2 de este documento, `main.py`), solo que ahora se conserva en vez de perderse antes de llegar a `mapping.zonas`.

**Dónde.** Un diccionario en memoria del proceso del backend (`{camara_id: DetectionFrameResult}`, `backend/app/routers/camaras.py`), poblado por `POST /camaras/{id}/deteccion-actual` —que llama `vision-module` en cada frame— y leído por `GET /camaras/{id}/deteccion-actual` para que el frontend haga polling. Sigue sin escribirse a disco ni a Supabase: no hay tabla ni archivo nuevo para esto.

**Condición de activación.** No es opt-in por pedido: mientras el módulo de visión esté corriendo, publica el resultado de cada frame sin que nadie lo pida explícitamente. Los dos endpoints están siempre activos y protegidos por `requiere_rol(ROL_ADMIN)`, igual que el resto del router de cámaras (`docs/roles-permisos.md`). Un fallo al publicar (backend caído, red, lo que sea) se descarta en silencio del lado de `vision-module` y nunca frena el loop de confirmación ni el cambio de estado de mesa: es información secundaria, no la función principal del sistema (`docs/vision-loop.md`).

**Criterio de retención.** Solo el último valor por cámara: cada `POST` sobrescribe la entrada anterior, no se guarda historial de detecciones ni se persiste entre pedidos más allá de la vida del proceso. Se pierde por completo al reiniciar el backend, y asume que corre en un solo worker —con más de uno, cada proceso tendría su propio diccionario y el `GET` podría devolver un valor desactualizado según a cuál le haya llegado el último `POST` (la misma limitación single-worker que ya deja constancia `docs/vision-loop.md` para el resto del pipeline).

## 4. Verificación: reconocimiento facial o re-identificación de personas

Se revisaron las dependencias declaradas en `requirements.txt` y se realizó una búsqueda de términos asociados a biometría (reconocimiento facial, re-identificación, embeddings de identidad) en todo el código del módulo.

El módulo depende únicamente de `ultralytics`, `opencv-python`, `numpy`, `requests`, `python-dotenv` y `pydantic`. No se incluye ninguna librería de reconocimiento facial, re-identificación o biometría. El componente de detección es un envoltorio directo del modelo YOLO de Ultralytics, sin ningún paso adicional de seguimiento entre frames, generación de embeddings o comparación de identidad.

**Conclusión:** el sistema no realiza, ni tiene capacidad para realizar en su configuración actual, reconocimiento facial ni re-identificación de personas.

## 5. Verificación: tratamiento diferenciado de detecciones de personas

Se evaluó si existe algún mecanismo que registre o almacene por separado las coordenadas o recortes visuales correspondientes a detecciones de personas, distinto del tratamiento dado a mesas o sillas.

La salida del detector es genérica para cualquier clase detectada (bounding box, clase, confianza), sin distinción de tratamiento entre personas, sillas o mesas. El filtrado de clases se realiza únicamente a nivel de configuración de inferencia (variable de entorno), no como un mecanismo de registro diferenciado. El componente encargado de cruzar detecciones con zonas del salón para determinar el estado de una mesa está aún sin implementar, por lo que tampoco existe hoy ningún archivo, tabla o registro que persista coordenadas o recortes de personas detectadas.

**Conclusión:** no existe actualmente registro diferenciado ni almacenamiento de información asociada específicamente a personas.

## 6. Verificación: exclusión de credenciales sensibles del control de versiones

Se revisó el archivo `.gitignore` de `vision-module/` y la forma en que se cargan las variables de entorno.

Las credenciales y configuración sensible (incluyendo la URL de fuente de video, que puede contener credenciales RTSP) se gestionan mediante un archivo `.env`, explícitamente excluido del control de versiones, con la única excepción versionada de `.env.example` como plantilla sin datos reales. El `.gitignore` cubre además los pesos del modelo, material de prueba, configuración real de zonas y artefactos generados por ejecución (video, logs).

**Conclusión:** las credenciales de acceso a fuentes de video se gestionan de forma separada del código versionado. Se recomienda confirmar mediante el historial de commits que no se haya versionado un archivo `.env` con datos reales antes de la incorporación de esta regla.

## 7. Síntesis y criterio a mantener

| Aspecto | Estado verificado |
| --- | --- |
| Persistencia de imágenes/video | No implementada; sin guardado en el pipeline real |
| Reconocimiento facial / re-identificación | No presente; no hay dependencias ni código para ello |
| Registro diferenciado de personas | No existe |
| Exclusión de credenciales sensibles | Correcta, vía `.gitignore` y `.env` |

Este documento debe actualizarse en cuanto se complete la implementación de `app/main.py` y `app/detection/zonas.py`, dado que son los componentes que definirán el comportamiento real y continuo del pipeline. Cualquier decisión de guardar evidencia visual (frames, clips) que se incorpore en adelante debe justificarse explícitamente aquí, indicando propósito, alcance y criterio de retención, antes de integrarse al código de producción.
