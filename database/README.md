# Migraciones de base de datos

El esquema de TableTracker vive en Supabase y hasta T26-137 se venía aplicando a mano, sin quedar
registrado en el repo. **Desde T26-137 el esquema lo gobierna Alembic**: las revisiones de
[versions/](versions/) son la única fuente de verdad, y `backend/app/main.py` ya no llama a
`Base.metadata.create_all`.

Ese `create_all` era justamente el problema: crea las tablas que faltan pero **nunca altera las que
ya existen**, así que un entorno nuevo nacía con el esquema de los modelos mientras producción
seguía con el suyo, y la diferencia sólo aparecía en runtime como una columna inexistente.

## Puesta en marcha

Desde la raíz del repo, con `DATABASE_URL` cargada en `backend/.env`:

```bash
alembic -c database/alembic.ini upgrade head
```

Eso deja la base lista para levantar la API. Es un paso obligatorio en un entorno nuevo: sin él no
hay tablas.

## Comandos de uso diario

| Qué querés | Comando |
|---|---|
| Ver en qué revisión está la base | `alembic -c database/alembic.ini current` |
| Ver el historial | `alembic -c database/alembic.ini history` |
| Aplicar lo que falte | `alembic -c database/alembic.ini upgrade head` |
| Volver una revisión atrás | `alembic -c database/alembic.ini downgrade -1` |
| Ver el SQL sin ejecutarlo | `alembic -c database/alembic.ini upgrade head --sql` |

## Crear una revisión

Después de tocar un modelo en `backend/app/models/`:

```bash
alembic -c database/alembic.ini revision --autogenerate -m "lo que cambia"
```

**Revisá siempre el archivo generado antes de aplicarlo.** El autogenerate detecta columnas, tipos,
constraints e índices, pero no adivina renombres (los ve como un DROP y un ADD, que pierde datos) ni
escribe migraciones de datos.

`env.py` corre con `compare_type` y `compare_server_default` activados a propósito: sin eso el
autogenerate ignora que una columna cambió de tipo o que la base tiene un `DEFAULT` que el modelo no
declara, que es exactamente el drift que este ticket vino a cerrar.

> Un `--autogenerate` que sale **vacío** significa que los modelos y la base coinciden. Es la forma
> más rápida de comprobar que no hay drift, y conviene correrlo antes de cada PR que toque modelos.

## Revisiones

| Revisión | Qué hace |
|---|---|
| `e72cc6e493dc` | Estado inicial: retrato del esquema tal como estaba en Supabase |
| `903cf408bb66` | Agrega `ix_camaras_id` e `ix_roi_mesa_id`, que la base no tenía |
| `6597e37ddeab` | Agrega los UNIQUE de `camaras.nombre` y `roi_mesa(mesa_id, camara_id)` (T26-141) |
| `841471d74b5b` | Agrega `configuracion_general.cantidad_mesas_referencia` (T26-156, RF-28) |

La inicial refleja **la base real y no los modelos**, incluidas sus imperfecciones: `camaras` y
`roi_mesa` —las dos tablas que T26-125 creó a mano— no tenían el índice sobre `id` que los modelos
declaran, y el CHECK de `configuracion_general` se llama `configuracion_general_singleton`. La
segunda revisión agrega los índices; el resto del drift se corrigió del lado del modelo, que era el
que mentía (faltaban 11 `server_default`).

Sobre una base que ya existía, la inicial se aplica con `alembic stamp e72cc6e493dc`, que sólo anota
la versión sin correr DDL. Ya se hizo en Supabase.

`6597e37ddeab` está en la misma situación por otro motivo: sus dos constraints se habían aplicado a
mano en Supabase antes de que la revisión existiera, así que en producción también se anotó con
`alembic stamp 6597e37ddeab` en vez de correr el upgrade, que habría fallado con «already exists».
Es la última vez que debería hacer falta: el esquema ya lo gobierna Alembic, y el atajo de tocar la
base por afuera es justo lo que deja a un entorno nuevo distinto de producción — que es como se
detectó esto, con el script de verificación de acá abajo.

## Verificación

```bash
cd backend
python scripts/verificar_esquema_versionado.py
```

Crea un schema descartable en la misma base, corre `upgrade head` desde cero, y compara columna por
columna, constraint por constraint e índice por índice contra `public`. Es la prueba de que **un
entorno nuevo levanta idéntico a producción**, que es lo que antes no se podía afirmar.

## Histórico

[historico/](historico/) guarda los `.sql` numerados de T26-136, la convención anterior a Alembic.
**Ya están aplicados**; quedan como registro de lo que se corrió y no hay que volver a ejecutarlos.
Su contenido está reflejado en la revisión inicial.

El estado base anterior a T26-136 (T26-125 y previo) nunca tuvo DDL en el repo: lo que hay es el
retrato que tomó la revisión inicial de este ticket.
