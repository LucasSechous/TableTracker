# TableTracker — Suite E2E (Playwright)

Cubre el plan de pruebas manual (secciones 1 a 6) contra el frontend y backend reales,
incluyendo el proyecto Supabase configurado en `backend/.env`.

## Requisitos previos

- `frontend/node_modules` instalado (`npm install` en `frontend/`).
- `backend/venv` con las dependencias de `requirements.txt` instaladas.
- `backend/.env` apuntando a la base contra la que se quiere correr la suite.

## Instalación

```bash
cd e2e
npm install
npx playwright install chromium
cp .env.example .env   # completar E2E_TEST_EMAIL / E2E_TEST_PASSWORD
```

`.env` no se commitea (contiene la contraseña del usuario de test contra el backend real).

`POST /auth/register` ahora exige rol admin (T26-116), así que el usuario de test ya no se
autoregistra solo. Antes de correr la suite por primera vez con esas credenciales, hay que
crearlo una única vez con el script de bootstrap (desde `backend/`, con el venv activado):

```bash
ADMIN_EMAIL=<mismo valor que E2E_TEST_EMAIL> ADMIN_PASSWORD=<mismo valor que E2E_TEST_PASSWORD> python -m app.seed_admin
```

Es idempotente (no hace nada si el email ya existe), así que correrlo de más no rompe nada.
Con el usuario ya creado, las corridas siguientes solo hacen login con lo que pusiste en `.env`.

## Ejecución

```bash
npm test              # corre toda la suite (levanta Vite y uvicorn automáticamente)
npm test -- tests/05-canvas-edicion.spec.ts   # un archivo puntual
npm run report         # abre el último reporte HTML
```

Playwright levanta el frontend (`npm run dev` en `frontend/`, puerto 5173) y el backend
(`uvicorn` del venv, puerto 8000) por su cuenta vía `webServer` en `playwright.config.ts`.
Si ya los tenés corriendo manualmente, los reutiliza en vez de levantar otra instancia.

## Datos de prueba

- El usuario definido en `e2e/.env` se crea una única vez con `python -m app.seed_admin` (ver
  más arriba). No hay endpoint para borrar usuarios, así que ese usuario queda permanentemente
  en la base — es intencional, para no crear uno nuevo en cada corrida.
- Cada test crea sus propios sectores/mesas con nombres únicos (sufijo de timestamp) vía la API
  y los borra en su `afterEach`. No se toca ni se borra ningún dato preexistente.

## Por qué un solo worker

`DashboardPage` dibuja **todos** los sectores/mesas de la base en posiciones absolutas dentro de
un único canvas de 1200x700 con `overflow:hidden` (sin scroll). Si dos workers corrieran en
paralelo, los sectores de prueba de uno podrían solaparse visualmente con los del otro y
interceptarse los clicks entre sí, sin forma fiable de aislarlos dentro de esas dimensiones fijas.
Por eso `playwright.config.ts` fija `workers: 1`.

## Por qué no hay `data-testid`

Por decisión explícita: los tests son 100% caja negra sobre el DOM tal como está hoy (texto visible,
`type` de los inputs, estructura de sectores/mesas). Esto los hace algo más frágiles ante refactors
de estilos/markup que un test con `data-testid`, a cambio de no tocar código de la aplicación.
