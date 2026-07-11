import { test, expect } from "../fixtures/test-fixtures";
import { createSector, createMesa, deleteMesa, deleteSector, uniqueSuffix } from "../fixtures/api-helpers";
import { getLogoutButton, getSectorBlock, getMesaCircle } from "../fixtures/ui-helpers";
import { BACKEND_URL } from "../playwright.config";

// Sección 3 — Rutas protegidas

test("3.1 acceder a /dashboard sin sesión redirige a /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("3.2 acceder a /dashboard con sesión activa carga el dashboard", async ({ page, token }) => {
  await page.addInitScript((t) => window.localStorage.setItem("token", t), token);
  await page.goto("/dashboard");
  await expect(getLogoutButton(page)).toBeVisible();
});

test("3.3 un token corrupto en localStorage redirige a login sin colgar la app", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // Nota: se evita addInitScript porque persiste en TODAS las navegaciones de la página,
  // y volvería a inyectar el token corrupto en el documento post-recarga, ocultando el
  // efecto real del interceptor. Se setea vía evaluate sobre un documento ya cargado.
  await page.goto("/login");
  await page.evaluate(() => window.localStorage.setItem("token", "esto-no-es-un-jwt-valido"));
  await page.goto("/");

  await page.waitForURL(/\/login$/, { timeout: 10_000 });
  // React StrictMode duplica el efecto de DashboardPage en dev: ambas invocaciones
  // reciben el 401 y cada una dispara su propio window.location.href, por lo que
  // pueden ocurrir dos navegaciones seguidas. Se espera a que la UI de /login quede
  // realmente estable antes de leer localStorage.
  await expect(page.getByRole("heading", { name: "TableTracker" })).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("load");
  const storedToken = await page.evaluate(() => window.localStorage.getItem("token"));
  expect(storedToken).toBeFalsy();
  expect(pageErrors).toEqual([]);
});

test("3.4 una respuesta 401 durante el uso normal se maneja sin romper la UI", async ({ page, token, request }) => {
  const suffix = uniqueSuffix(test.info().parallelIndex);
  const sector = await createSector(request, token, { nombre: `E2E 401 ${suffix}` });
  const mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id });

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.addInitScript((t) => window.localStorage.setItem("token", t), token);
  await page.goto("/");

  const sectorBlock = getSectorBlock(page, sector.nombre);
  await expect(sectorBlock).toBeVisible();
  const mesaCircle = getMesaCircle(sectorBlock, mesa.numero);

  // A partir de acá, cualquier request a /mesas/*/estado devuelve 401 forzado.
  await page.route(`${BACKEND_URL}/mesas/*/estado`, (route) =>
    route.fulfill({ status: 401, json: { detail: "Token inválido o expirado" } })
  );

  await mesaCircle.click();
  await page.locator("select").first().selectOption("ocupada");

  await page.waitForURL(/\/login$/, { timeout: 10_000 });
  expect(pageErrors).toEqual([]);

  await page.unroute(`${BACKEND_URL}/mesas/*/estado`);
  await deleteMesa(request, token, mesa.id);
  await deleteSector(request, token, sector.id);
});
