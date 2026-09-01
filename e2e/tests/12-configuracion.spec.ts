import { test, expect } from "../fixtures/test-fixtures";
import {
  obtenerConfiguracion,
  actualizarConfiguracion,
  listarSectores,
  uniqueSuffix,
  ConfiguracionResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  gotoConfiguracionAuthed,
  getConfiguracionNombreInput,
  getConfiguracionCantidadMesasInput,
  getConfiguracionAnchoInput,
  getConfiguracionAltoInput,
  getConfiguracionGuardarButton,
  getConfiguracionDeshacerButton,
  getConfiguracionExito,
  getConfiguracionError,
} from "../fixtures/ui-helpers";

// Sección 12 — Pantalla de configuración de admin (T26-160, RF-28)
//
// configuracion_general es una tabla SINGLETON: no se puede crear una fila de prueba
// desechable como con sectores y mesas. Cada test guarda el estado original en el
// beforeEach y lo restaura en el afterEach, para no dejar la configuración del entorno
// pisada por los valores del test.
//
// Los valores de tamaño se eligen siempre por encima del mínimo real del salón (calculado
// desde los sectores existentes), porque achicar el salón por debajo de sus sectores es
// justamente lo que la pantalla impide.

let configOriginal: ConfiguracionResponse;

test.beforeEach(async ({ request, token }) => {
  configOriginal = await obtenerConfiguracion(request, token);
});

test.afterEach(async ({ request, token }) => {
  await actualizarConfiguracion(request, token, {
    ancho_salon: configOriginal.ancho_salon,
    alto_salon: configOriginal.alto_salon,
    nombre_establecimiento: configOriginal.nombre_establecimiento ?? "",
    // Si originalmente era null se omite: el backend no acepta volver a null (gt=0 y
    // exclude_none), así que forzarlo tiraría 422 y rompería la limpieza.
    ...(configOriginal.cantidad_mesas_referencia != null
      ? { cantidad_mesas_referencia: configOriginal.cantidad_mesas_referencia }
      : {}),
  }).catch(() => {});
});

test("12.1 acceder a /configuracion sin sesión redirige a /login", async ({ page }) => {
  await page.goto("/configuracion");
  await expect(page).toHaveURL(/\/login$/);
});

test("12.2 la entrada del menú lateral navega a configuración", async ({ page, token }) => {
  await gotoDashboardAuthed(page, token);
  await page.getByRole("button", { name: "Abrir menú" }).click();

  const entrada = page.getByRole("button", { name: "Configuración" });
  await expect(entrada).toBeVisible();
  await entrada.click();

  await expect(page).toHaveURL(/\/configuracion$/);
  await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
});

test("12.3 el formulario carga los valores actuales del backend", async ({ page, token }) => {
  await gotoConfiguracionAuthed(page, token);

  await expect(getConfiguracionNombreInput(page)).toHaveValue(configOriginal.nombre_establecimiento ?? "");
  await expect(getConfiguracionAnchoInput(page)).toHaveValue(String(configOriginal.ancho_salon));
  await expect(getConfiguracionAltoInput(page)).toHaveValue(String(configOriginal.alto_salon));
  await expect(getConfiguracionCantidadMesasInput(page)).toHaveValue(
    configOriginal.cantidad_mesas_referencia?.toString() ?? ""
  );

  // Sin cambios no hay nada que guardar ni que deshacer.
  await expect(getConfiguracionGuardarButton(page)).toBeDisabled();
  await expect(getConfiguracionDeshacerButton(page)).toBeDisabled();
});

test("12.4 guardar persiste los campos de RF-28 en el backend", async ({ page, token, request }) => {
  const nombreNuevo = `E2E Config ${uniqueSuffix(test.info().parallelIndex)}`;
  const cantidadNueva = 42;

  await gotoConfiguracionAuthed(page, token);
  await getConfiguracionNombreInput(page).fill(nombreNuevo);
  await getConfiguracionCantidadMesasInput(page).fill(String(cantidadNueva));

  await expect(getConfiguracionGuardarButton(page)).toBeEnabled();
  await getConfiguracionGuardarButton(page).click();
  await expect(getConfiguracionExito(page)).toBeVisible();

  // La afirmación fuerte es contra la API, no contra el formulario: que el input muestre
  // el valor no prueba que se haya guardado.
  const guardada = await obtenerConfiguracion(request, token);
  expect(guardada.nombre_establecimiento).toBe(nombreNuevo);
  expect(guardada.cantidad_mesas_referencia).toBe(cantidadNueva);

  // El tamaño del salón no se tocó y tiene que haber quedado igual.
  expect(guardada.ancho_salon).toBe(configOriginal.ancho_salon);
  expect(guardada.alto_salon).toBe(configOriginal.alto_salon);
});

test("12.5 no deja achicar el salón por debajo de lo que ocupan los sectores", async ({
  page,
  token,
  request,
}) => {
  const sectores = await listarSectores(request, token);
  const activos = sectores.filter((s) => s.activo);
  test.skip(activos.length === 0, "sin sectores activos no hay mínimo que validar");

  const minAncho = Math.max(...activos.map((s) => s.pos_x + s.ancho));

  await gotoConfiguracionAuthed(page, token);
  await getConfiguracionAnchoInput(page).fill(String(Math.max(1, minAncho - 100)));
  await getConfiguracionGuardarButton(page).click();

  await expect(getConfiguracionError(page)).toBeVisible();
  await expect(getConfiguracionError(page)).toContainText(String(minAncho));
  await expect(getConfiguracionExito(page)).toHaveCount(0);

  // El backend solo valida gt=0, así que este límite lo pone el frontend: lo que importa
  // es que NO haya salido el PATCH.
  const sinCambios = await obtenerConfiguracion(request, token);
  expect(sinCambios.ancho_salon).toBe(configOriginal.ancho_salon);
});

test("12.6 deshacer devuelve el formulario a los valores cargados", async ({ page, token }) => {
  await gotoConfiguracionAuthed(page, token);

  await getConfiguracionNombreInput(page).fill("Valor descartable");
  await expect(getConfiguracionDeshacerButton(page)).toBeEnabled();

  await getConfiguracionDeshacerButton(page).click();

  await expect(getConfiguracionNombreInput(page)).toHaveValue(configOriginal.nombre_establecimiento ?? "");
  await expect(getConfiguracionDeshacerButton(page)).toBeDisabled();
});
