-- T26-136 — fase 3: cerrar la migración y borrar la columna en claro.
-- YA APLICADO. Movido a database/historico/ por T26-137, que pasó el esquema a
-- Alembic: las rutas «database/00X_...» que se nombran más abajo eran las de
-- cuando esto se corrió. No hay que volver a ejecutarlo; su resultado está
-- reflejado en la revisión inicial de database/versions/.
--
--
-- Corré esto SOLO después de 001, del script de migración, y de haber verificado
-- que la app funciona: listar cámaras, probar conexión y sacar un snapshot. Esta
-- fase sí destruye datos — es el paso que elimina la última copia de las
-- contraseñas en claro, que es justamente el objetivo del ticket.
--
-- Antes de correrlo, tomá un backup de la base desde Supabase (Database →
-- Backups). El script de migración a propósito NO deja una copia en disco: un
-- archivo con las contraseñas en claro sería exactamente el problema que este
-- ticket viene a resolver.
--
-- Uso: pegalo en el SQL Editor de Supabase, o
--   psql "$DATABASE_URL" -f database/002_camaras_baja_rtsp_url.sql

BEGIN;

-- Guarda: si quedó alguna fila sin migrar, esto aborta la transacción entera y
-- no se borra nada. Es preferible a descubrir después que una cámara perdió su
-- configuración.
DO $$
DECLARE
    pendientes integer;
BEGIN
    SELECT count(*) INTO pendientes FROM camaras WHERE host IS NULL;
    IF pendientes > 0 THEN
        RAISE EXCEPTION
            'Quedan % cámara(s) sin migrar (host IS NULL). Corré primero: python database/migrar_credenciales_camaras.py',
            pendientes;
    END IF;
END $$;

ALTER TABLE camaras ALTER COLUMN host SET NOT NULL;
ALTER TABLE camaras DROP COLUMN rtsp_url;

COMMIT;
