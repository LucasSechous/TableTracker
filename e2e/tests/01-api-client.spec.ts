import { test, expect } from "../fixtures/test-fixtures";
import { BACKEND_URL } from "../playwright.config";
import { gotoDashboardAuthed } from "../fixtures/ui-helpers";

// Sección 1 — Configuración inicial / Cliente API

test("1.1 la app carga sin errores en consola (login y dashboard)", async ({ page, token }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "TableTracker" })).toBeVisible();

  await gotoDashboardAuthed(page, token);
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

  expect(consoleErrors, `Errores de consola detectados: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("1.2 los requests van a la URL de backend configurada", async ({ page }) => {
  const backendRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/auth/login")) backendRequests.push(req.url());
  });

  await page.goto("/login");
  await page.locator('input[type="email"]').fill("nadie@example.com");
  await page.locator('input[type="password"]').fill("loquesea");
  await page.getByRole("button", { name: /Ingresar/ }).click();

  await expect.poll(() => backendRequests.length).toBeGreaterThan(0);
  for (const url of backendRequests) {
    expect(url.startsWith(BACKEND_URL)).toBe(true);
  }
});

test("1.3 con sesión activa, los requests a /mesas y /sectores llevan Authorization: Bearer <token>", async ({
  page,
  token,
}) => {
  // Se ignoran los preflights OPTIONS (nunca llevan Authorization). React StrictMode
  // duplica el efecto en dev, y la segunda invocación puede resolverse desde la caché
  // del navegador con headers mínimos; por eso se busca "al menos una" request real
  // con el header correcto, en vez de exigirlo en la última observada.
  const mesasHeaders: (string | undefined)[] = [];
  const sectoresHeaders: (string | undefined)[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") return;
    const url = req.url();
    if (url.includes("/mesas")) mesasHeaders.push(req.headers()["authorization"]);
    if (url.includes("/sectores")) sectoresHeaders.push(req.headers()["authorization"]);
  });

  await gotoDashboardAuthed(page, token);

  const expectedAuth = `Bearer ${token}`;
  await expect.poll(() => mesasHeaders.includes(expectedAuth)).toBe(true);
  await expect.poll(() => sectoresHeaders.includes(expectedAuth)).toBe(true);
});

test("1.4 si el backend no responde, la app no queda en blanco", async ({ page, token }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.route(`${BACKEND_URL}/**`, (route) => route.abort("connectionrefused"));

  await page.addInitScript((t) => window.localStorage.setItem("token", t), token);
  await page.goto("/");

  // Comportamiento real observado: authApi.me() falla (network error) y DashboardPage
  // redirige a /login en su catch — no se queda colgada ni en blanco.
  await page.waitForURL(/\/login$/, { timeout: 10_000 });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText.trim().length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
