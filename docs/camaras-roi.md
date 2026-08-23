# Cámaras y ROI por mesa (RF-30, RF-31, RF-12)

CRUD de cámaras con prueba de conexión RTSP, y CRUD de las regiones de interés (ROI) que
asocian cada mesa con su polígono dentro del frame de una cámara.

Ambos recursos son **solo `admin`** en todos los verbos — ver
[roles-permisos.md](roles-permisos.md).

## El modelo de datos lo define T26-125, no estos tickets

Las tablas `camaras` y `roi_mesa` **ya existían en Supabase** cuando se tomaron estos tickets,
pero **no están en el repo**: T26-125 se aplicó como DDL directo sobre la base, sin modelos
SQLAlchemy ni migración versionada. Como `Base.metadata.create_all` solo crea tablas que faltan y
nunca altera las que existen, los modelos de acá **reflejan** ese esquema, no lo deciden.

Eso tenía dos consecuencias, **las dos resueltas por T26-137**:

- El esquema real no estaba bajo control de versiones, así que un cambio en Supabase dejaba los
  modelos de [backend/app/models/](../backend/app/models/) desincronizados en silencio y el error
  aparecía recién en runtime, como columna inexistente.
- Cualquier entorno nuevo levantaba con un esquema **distinto** al de producción: `create_all`
  creaba las tablas desde los modelos, que no reproducían los `DEFAULT` del DDL original.

Hoy el esquema lo gobierna **Alembic** desde [database/versions/](../database/versions/), y
`main.py` ya no llama a `create_all` — levantar un entorno nuevo requiere
`alembic -c database/alembic.ini upgrade head`. Ver el
[README de database/](../database/README.md).

T26-137 midió el drift que ya se había acumulado y lo cerró: a `camaras` y `roi_mesa` —las dos
tablas creadas a mano— les faltaba el índice sobre `id` que los modelos declaran, y once columnas
tenían `DEFAULT` en la base que los modelos sólo declaraban del lado de Python. Que un
`--autogenerate` salga vacío es ahora la prueba de que modelos y base coinciden, y
`backend/scripts/verificar_esquema_versionado.py` comprueba que un entorno nuevo nace idéntico a
producción.

### `camaras` — [backend/app/models/camara.py](../backend/app/models/camara.py)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | serial PK | |
| `nombre` | varchar NOT NULL | **Sin UNIQUE en la base**: la unicidad se controla en el router |
| `esquema` | varchar NOT NULL, default `rtsp` | `rtsp` o `rtsps` |
| `host` | varchar NOT NULL | |
| `puerto` | integer NOT NULL, default 554 | |
| `ruta` | varchar NOT NULL, default `/` | Incluye la query cuando la hay (`?channel=1`) |
| `usuario` | varchar NULL | En claro: no es secreto |
| `password_cifrada` | text NULL | Token Fernet. NULL = la cámara no tiene contraseña |
| `sector_id` | FK `sectores.id` NOT NULL | Toda cámara pertenece a un sector |
| `activa` | bool, default true | Baja lógica |
| `created_at` | timestamptz, default now() | |

T26-125 tenía en lugar de las cinco columnas de conexión una sola, `rtsp_url varchar NOT NULL`,
con la URL entera y la contraseña en claro. **T26-136 la reemplazó**; la migración está
versionada en [database/](../database/) y es el primer cambio de esquema del proyecto que queda
registrado en el repo.

### `roi_mesa` — [backend/app/models/roi_mesa.py](../backend/app/models/roi_mesa.py)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | serial PK | |
| `mesa_id` | FK `mesas.id` NOT NULL | |
| `camara_id` | FK `camaras.id` NOT NULL | |
| `coordenadas` | jsonb NOT NULL | `[[x, y], ...]` en píxeles del frame |
| `activa` | bool, default true | Baja lógica |
| `created_at` | timestamptz, default now() | |

**No hay UNIQUE sobre (`mesa_id`, `camara_id`)**. La regla "una mesa tiene un solo ROI por
cámara" se aplica únicamente en el router, así que no tiene respaldo del motor: dos altas
simultáneas del mismo par podrían pasar las dos. Una mesa sí puede tener ROI en varias cámaras
distintas (mesas en el límite entre dos campos de visión), eso es intencional.

El contenido de `coordenadas` usa el mismo formato que ya consume el módulo de visión en
[vision-module/config/zonas.example.json](../vision-module/config/zonas.example.json) bajo la
clave `poligono`, así que no hay traducción entre lo que guarda el backend y lo que lee el
pipeline de detección. El backend valida mínimo 3 puntos y coordenadas no negativas; el límite
superior depende de la resolución de la cámara, que el backend no conoce, así que esa validación
queda del lado del módulo de visión.

## Credenciales RTSP

La API habla en URLs completas —se recibe y se devuelve un único campo `rtsp_url`— pero **la base
no las guarda así**. Al escribir, la URL se descompone en columnas y la contraseña se cifra; al
leer, se rearma. El frontend no sabe nada de esto.

```
rtsp://usuario:password@host:puerto/ruta     lo que viaja por la API
        └── cifrada ──┘                       lo único secreto de esa cadena
```

### Por qué separada en columnas y no la URL entera cifrada (T26-136)

Las dos opciones estaban sobre la mesa. Se eligió separar por dos motivos concretos:

- **El `GET` no descifra nada.** Para enmascarar alcanza con esquema, host, puerto, ruta y
  usuario, que están en claro. Listar veinte cámaras no pasa veinte contraseñas por memoria: la
  contraseña solo se descifra en `test-conexion` y `snapshot`, que operan sobre una sola cámara.
- **Perder la clave cuesta recargar contraseñas, no perder las cámaras.** Con la URL entera
  cifrada, quedarse sin clave se lleva puesta también la configuración de red de cada cámara.

Se cifra con **Fernet** (AES-128-CBC + HMAC-SHA256, de `cryptography`, que ya entraba como
dependencia de `python-jose`) desde
[backend/app/services/cifrado.py](../backend/app/services/cifrado.py), y **no con pgcrypto**: con
pgcrypto la clave viaja como argumento dentro de cada sentencia SQL, así que termina en los logs
de consultas del servidor y a la vista de cualquiera con acceso a la base — justo lo que este
ticket venía a evitar. Cifrando en el backend, la base nunca ve la clave.

La clave sale de `CAMARA_ENCRYPTION_KEYS`, **distinta de `SECRET_KEY`** (la del JWT) para que
filtrar una no comprometa la otra. Si falta, los endpoints que la necesitan devuelven un 500 que
dice qué revisar; **nunca hay un fallback a texto plano**, porque guardar en claro sin que nadie
se entere es peor que fallar.

**`esquema` se guarda aparte** porque `rtsps` es RTSP sobre TLS: reconstruir siempre como `rtsp`
degradaría en silencio un stream cifrado a uno en claro.

### Rotación

`CAMARA_ENCRYPTION_KEYS` admite varias claves separadas por coma. **La primera cifra; las demás
solo descifran**, así que se rota sin ventana de indisponibilidad: se agrega la nueva adelante, la
API sigue leyendo lo viejo, `backend/scripts/rotar_clave_camaras.py` recifra las filas, y recién
ahí se saca la vieja del `.env`. Si se saca la vieja antes de recifrar, las contraseñas dejan de
abrir y el 500 explica exactamente cómo volver atrás. El procedimiento paso a paso está en la
cabecera del script y en [database/README.md](../database/README.md).

### Cómo se expone

Esto no cambió con T26-136 — el contrato de la API es el mismo de T26-126/127:

- **La contraseña nunca sale de la API.** `GET /camaras/` devuelve `rtsp_url` enmascarada
  (`rtsp://admin:***@host:puerto/ruta`) más `tiene_credenciales`. El enmascarado está en
  `rtsp.enmascarar_partes()`.
- **Reenviar la URL enmascarada da 422.** Como la respuesta y el campo de escritura se llaman
  igual, un cliente podría hacer `GET`, editar el nombre y `PATCH`ear todo de vuelta, guardando
  `***` como contraseña real. El validador rechaza cualquier URL cuya contraseña sea `***` y
  aclara que hay que mandar la URL completa o dejar el campo afuera.
- **La URL se valida al escribirla** (esquema `rtsp://`/`rtsps://`, host presente, puerto
  numérico) para no guardar cadenas que después fallen recién al probar la conexión.

- **La URL se valida al escribirla** (esquema `rtsp://`/`rtsps://`, host presente, puerto
  numérico) para no guardar cadenas que después fallen recién al probar la conexión. Desde T26-136
  esa validación además decide cómo se reparte en columnas.

El enmascarado se arma desde las columnas (`rtsp.enmascarar_partes`) y no desde una URL guardada,
pero produce **exactamente la misma cadena** que antes. Eso importa más de lo que parece: el
centinela `***` no puede pasar por `quote()` —lo escaparía como `%2A%2A%2A`— y
`ModalEditarCamara.tsx` compara texto para decidir si manda `rtsp_url` en el `PATCH`, así que
cualquier diferencia de un carácter haría que la UI reenviara la URL enmascarada en cada edición.

## Prueba de conexión

`POST /camaras/{id}/test-conexion?timeout_segundos=5` (1 a 15, default 5).

En vez de levantar un decodificador de video, se hace el handshake del propio protocolo RTSP
—que es texto sobre TCP, muy parecido a HTTP/1.0— desde
[backend/app/services/rtsp.py](../backend/app/services/rtsp.py):

1. `OPTIONS` confirma que del otro lado hay efectivamente un servidor RTSP.
2. `DESCRIBE` confirma que el stream pedido existe y que las credenciales sirven. Si responde
   `401`, se resuelve el desafío (Digest con y sin `qop`, o Basic) y se reintenta.

Es lo mismo que hace un cliente real antes de empezar a recibir video. El motivo de no usar
OpenCV/ffmpeg es que son ~100 MB de dependencias solo para esto, y el backend no procesa video:
de eso se encarga `vision-module`.

**Los tres pedidos van por la misma conexión TCP, y eso es obligatorio.** Los servidores basados
en LIVE555 —el stack RTSP de muchísimas cámaras IP genéricas— atan el *nonce* del desafío Digest
a la conexión que lo emitió. Si el `DESCRIBE` autenticado sale por un socket nuevo, la cámara
responde `401` para siempre aunque el usuario y la contraseña sean correctos. Se detectó
probando contra una cámara real (`realm="LIVE555 Streaming Media"`, Digest sin `qop`) que VLC
abría sin problema y el endpoint rechazaba.

Como contrapartida, otras cámaras cierran el socket apenas contestan, así que `_Conexion`
reintenta una vez en una conexión nueva si el envío o la lectura se cortan. En Windows ese corte
aparece recién en el `recv` (el `sendall` queda en el buffer del sistema), por eso se atrapa
`ConnectionError` alrededor de las dos operaciones y no solo del envío.

**El endpoint siempre responde HTTP 200**: que la cámara no conteste no es un error de la API. El
diagnóstico viaja en el cuerpo, listo para mostrar tal cual:

```json
{
  "ok": false,
  "mensaje": "La ruta del stream no existe en la cámara: revisá el campo «ruta»",
  "codigo_rtsp": 404,
  "latencia_ms": 38,
  "rtsp_url": "rtsp://admin:***@192.168.1.50:554/Streaming/Channels/101"
}
```

Se traducen a castellano los códigos 200, 401, 403, 404, 453, 455 y 503, más los fallos de red
(host que no resuelve, conexión rechazada, timeout, puerto abierto que no habla RTSP) y la URL
mal formada.

## Snapshot para calibración de ROI (T26-134, RF-12)

`GET /camaras/{id}/snapshot?timeout_segundos=5` (1 a 15, default 5). Devuelve un JPEG
(`image/jpeg`) con un frame actual de la cámara, para que la pantalla de calibración de ROI
(T26-128) tenga sobre qué dibujar el polígono.

A diferencia de `test-conexion`, acá **sí hace falta decodificar el stream**: el handshake por
socket de `rtsp.py` confirma que la cámara responde pero no entrega imagen. Por eso este endpoint
usa `cv2.VideoCapture` (backend FFMPEG) de `opencv-python-headless`, que T26-126/T26-127
deliberadamente evitaron. Es la primera dependencia de decodificación de video que suma el
backend — ver el detalle de tamaño y la discusión de por qué en el PR de T26-134.

No persiste nada ni mantiene el stream abierto: abre, lee un frame, cierra. El timeout se pasa en
el constructor de `VideoCapture` (no con `.set()` después de crearlo — la propiedad se pierde en
silencio y la apertura cae al default de OpenCV, ~30 s, en vez del pedido). Igual que
`test-conexion`, una cámara caída o que no entrega frame no es un 500: responde `504` con mensaje
en castellano, y la URL con contraseña nunca aparece en la respuesta ni en logs.

## Endpoints

Prefijos: `/camaras` y `/roi-mesa` (la URL sigue el nombre de la entidad del ticket, `roi_mesa`).

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/camaras/` | Lista. Filtros: `sector_id`, `incluir_inactivas` |
| GET | `/camaras/{id}` | |
| POST | `/camaras/` | 409 si el nombre ya existe, 400 si el sector no existe |
| PATCH | `/camaras/{id}` | Edición parcial |
| DELETE | `/camaras/{id}` | **Baja lógica** (`activa=false`) |
| POST | `/camaras/{id}/test-conexion` | Prueba RTSP |
| GET | `/camaras/{id}/snapshot` | Frame JPEG para calibración de ROI (T26-134) |
| GET | `/roi-mesa/` | Lista. Filtros: `mesa_id`, `camara_id`, `incluir_inactivos` |
| GET | `/roi-mesa/{id}` | |
| POST | `/roi-mesa/` | 409 si esa mesa ya tiene ROI en esa cámara, 400 si mesa o cámara no existen |
| PATCH | `/roi-mesa/{id}` | Edición parcial |
| DELETE | `/roi-mesa/{id}` | **Baja lógica** (`activa=false`) |

Detalles de comportamiento que no se deducen de la tabla:

- **`DELETE` es baja lógica en los dos recursos**, porque los tickets piden "crear, editar,
  desactivar" y no borrado físico. Para reactivar: `PATCH` con `activa` en `true`. Difiere de
  `/mesas` y `/sectores`, donde `DELETE` borra físico.
- **`PATCH` usa `exclude_unset`**, a diferencia de `/mesas` y `/sectores` que usan
  `exclude_none`. Así se distingue "no toques este campo" (omitirlo) de un valor mandado a
  propósito. Mandar `null` en un campo NOT NULL devuelve 422 en vez de reventar contra la base.
- **Recrear un ROI dado de baja lo reactiva.** Como la baja es lógica, la fila de ese par
  mesa+cámara sigue existiendo; un `POST` sobre un par inactivo la reusa, le pisa las coordenadas
  y la vuelve a activar (devuelve 201 con el `id` original) en vez de dejar dos filas para el
  mismo par.
- **Desactivar una cámara no desactiva sus ROI en cascada**: quedan como estaban para que
  reactivarla no obligue a redibujarlos.

## Fuera de alcance (hallazgos, no corregidos acá)

- ~~**El esquema base de T26-125 no está versionado**~~ — lo resolvió T26-137, que dejó el esquema
  entero bajo Alembic. La contraseña RTSP en claro, el otro hallazgo de acá, la resolvió T26-136.
- **El módulo de visión todavía no consume estos endpoints.** Sigue leyendo los ROI de un archivo
  local (`ZONES_FILE`, ver [vision-module/app/config.py](../vision-module/app/config.py)); nadie
  lee `roi_mesa` ni `camaras` fuera de la API. Conectar el pipeline a la base necesita un ticket
  aparte, y ahí va a hacer falta decidir con qué identidad entra: hoy `GET /roi-mesa/` es solo
  `admin`, así que el usuario de servicio del módulo tendría que ser admin o habría que abrir un
  rol de lectura para visión. (El usuario `vision-module@tabletracker.com` que existe hoy en la
  base tiene rol `mozo`, así que recibiría 403.)
- **No hay prueba de conexión previa al alta.** `test-conexion` opera sobre una cámara ya
  guardada; para que la UI pueda validar los datos antes de crearla haría falta una variante que
  reciba la URL en el cuerpo.
- **Sin suite de tests de backend.** El proyecto no tiene pytest del lado del backend, solo la de
  Playwright en `e2e/`. La implementación de T26-126/127 se verificó contra SQLite y un servidor
  RTSP falso (Digest con y sin `qop`, Basic, contraseña incorrecta, 404, timeout, puerto cerrado,
  URL inválida), pero esos scripts quedaron fuera del repo. T26-136 sí dejó el suyo:
  [backend/scripts/verificar_cifrado_camaras.py](../backend/scripts/verificar_cifrado_camaras.py)
  levanta la API con `TestClient` contra un SQLite temporal y corre 65 chequeos. Es un script, no
  una suite: hay que acordarse de correrlo. Sigue valiendo un ticket para montar pytest y sumar
  `/camaras` y `/roi-mesa` ahí.
- **SSRF por diseño.** `test-conexion` hace que el backend abra una conexión TCP a un host y
  puerto que elige el usuario. Es inherente a la función (las cámaras están en la red interna) y
  está acotado a `admin`, pero conviene tenerlo presente si el endpoint se abriera a otro rol.
