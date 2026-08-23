-- T26-136 — fase 1: columnas nuevas en `camaras`.
-- YA APLICADO. Movido a database/historico/ por T26-137, que pasó el esquema a
-- Alembic: las rutas «database/00X_...» que se nombran más abajo eran las de
-- cuando esto se corrió. No hay que volver a ejecutarlo; su resultado está
-- reflejado en la revisión inicial de database/versions/.
--
--
-- Hasta acá la conexión iba entera en `camaras.rtsp_url`, con la contraseña en
-- claro (esquema de T26-125). Esta fase agrega las columnas separadas y deja la
-- vieja en su lugar: no borra ni modifica ningún dato existente, así que es
-- segura de correr con la API arriba.
--
-- Después de esta fase corré database/migrar_credenciales_camaras.py, que llena
-- las columnas nuevas a partir de rtsp_url y cifra la contraseña. Recién cuando
-- verifiques que la app anda, corré 002.
--
-- Uso: pegalo en el SQL Editor de Supabase, o
--   psql "$DATABASE_URL" -f database/001_camaras_credenciales_cifradas.sql

BEGIN;

ALTER TABLE camaras
    -- rtsp o rtsps: reconstruir siempre como rtsp degradaría en silencio un
    -- stream TLS a uno en claro.
    ADD COLUMN IF NOT EXISTS esquema          varchar NOT NULL DEFAULT 'rtsp',
    -- Nullable en esta fase: lo llena el script de migración. Pasa a NOT NULL en 002.
    ADD COLUMN IF NOT EXISTS host             varchar,
    ADD COLUMN IF NOT EXISTS puerto           integer NOT NULL DEFAULT 554,
    -- Incluye la query cuando la hay (?channel=1&subtype=0).
    ADD COLUMN IF NOT EXISTS ruta             varchar NOT NULL DEFAULT '/',
    ADD COLUMN IF NOT EXISTS usuario          varchar,
    -- Token Fernet. NULL = la cámara no tiene contraseña.
    ADD COLUMN IF NOT EXISTS password_cifrada text;

-- El backend nuevo ya no conoce la columna `rtsp_url`, así que mientras siga
-- existiendo tiene que admitir NULL: si no, dar de alta una cámara entre esta
-- fase y la 002 fallaría con una violación de NOT NULL.
ALTER TABLE camaras ALTER COLUMN rtsp_url DROP NOT NULL;

COMMIT;
