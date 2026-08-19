# Migraciones de base de datos

El esquema de TableTracker vive en Supabase y hasta ahora se venía aplicando a mano, sin quedar
registrado en el repo — es un hallazgo anotado en
[docs/camaras-roi.md](../docs/camaras-roi.md). Esta carpeta arranca a revertir eso: **de acá en
adelante, todo cambio de esquema se versiona como un `.sql` numerado antes de aplicarse.**

No hay Alembic ni tabla de versiones todavía. Los archivos se corren a mano, en orden, una sola
vez, y son idempotentes donde se pudo (`ADD COLUMN IF NOT EXISTS`). Lo que ya existía antes de
esta carpeta (T26-125 y anterior) no está acá: solo lo nuevo.

## Cómo correr un `.sql`

Desde el SQL Editor de Supabase (pegar y ejecutar), o con psql:

```bash
psql "$DATABASE_URL" -f database/001_camaras_credenciales_cifradas.sql
```

## Migraciones

### T26-136 — cifrar las credenciales RTSP

Reemplaza `camaras.rtsp_url` (la conexión entera, con la contraseña en claro) por una columna por
parte, con la contraseña cifrada con Fernet. El detalle de por qué se separó en columnas en vez de
cifrar la URL entera está en [docs/camaras-roi.md](../docs/camaras-roi.md).

**Antes de empezar**, generá la clave de cifrado y ponela en `backend/.env`:

```bash
cd backend
python scripts/rotar_clave_camaras.py --generar-clave   # imprime la clave
# pegarla en backend/.env:  CAMARA_ENCRYPTION_KEYS=<clave>
```

Sin esa variable el backend no puede leer ni guardar contraseñas de cámaras, y lo dice con un 500
explicado en vez de caer en texto plano.

Después, en este orden:

| # | Paso | Qué hace | ¿Destructivo? |
|---|------|----------|---------------|
| 1 | `001_camaras_credenciales_cifradas.sql` | Agrega las columnas nuevas y saca el `NOT NULL` de `rtsp_url` | No |
| 2 | `python database/migrar_credenciales_camaras.py --dry-run` | Muestra qué se migraría, sin escribir | No |
| 3 | `python database/migrar_credenciales_camaras.py` | Llena las columnas nuevas y cifra las contraseñas | No (no toca `rtsp_url`) |
| 4 | *Verificar la app* | Listar cámaras, `test-conexion` y snapshot contra una cámara real | — |
| 5 | `002_camaras_baja_rtsp_url.sql` | Pone `host` en `NOT NULL` y **borra** `rtsp_url` | **Sí** |

Entre el paso 1 y el 5 la base queda en un estado intermedio perfectamente usable: las columnas
nuevas y la vieja conviven, y el backend nuevo ya funciona contra las nuevas. Eso es a propósito —
permite verificar con datos reales antes del paso que no se puede deshacer.

El paso 5 es el que elimina la última copia de las contraseñas en claro. **Tomá un backup desde
Supabase (Database → Backups) antes de correrlo.** El script de migración no deja una copia en
disco a propósito: un archivo con las contraseñas en claro sería exactamente lo que este ticket
viene a eliminar.

### Rotar la clave

`backend/scripts/rotar_clave_camaras.py` recifra las filas con la clave activa.
`CAMARA_ENCRYPTION_KEYS` admite varias claves separadas por coma: la primera cifra, las demás solo
descifran, así que se rota sin ventana de indisponibilidad. El procedimiento paso a paso está en la
cabecera del propio script.
