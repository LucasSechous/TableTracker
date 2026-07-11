import { test, expect } from "../fixtures/test-fixtures";
import { TEST_USER } from "../fixtures/api-helpers";
import {
  getEmailInput,
  getPasswordInput,
  getSubmitButton,
  gotoDashboardAuthed,
  getLogoutButton,
} from "../fixtures/ui-helpers";

// Sección 2 — Login y sesión

test("2.1 login con credenciales válidas redirige al dashboard y guarda el token", async ({ page, userEnsured }) => {
  await page.goto("/login");
  await getEmailInput(page).fill(TEST_USER.email);
  await getPasswordInput(page).fill(TEST_USER.password);
  await getSubmitButton(page).click();

  await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
  const token = await page.evaluate(() => window.localStorage.getItem("token"));
  expect(token).toBeTruthy();
});

test("2.2 login con credenciales inválidas muestra error y no redirige", async ({ page, userEnsured }) => {
  // El interceptor de respuesta en services/api.ts no debe tratar el 401 de un login
  // fallido como sesión expirada (eso dispararía un reload completo que borra el
  // formulario y tapa el mensaje de error). Se verifica que no haya una segunda carga
  // de página además del mensaje de error.
  const loads: string[] = [];
  page.on("load", () => loads.push(page.url()));

  await page.goto("/login");
  await getEmailInput(page).fill(TEST_USER.email);
  await getPasswordInput(page).fill("password-incorrecta-a-proposito");
  await getSubmitButton(page).click();

  await expect(page.getByText("Credenciales incorrectas")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  const token = await page.evaluate(() => window.localStorage.getItem("token"));
  expect(token).toBeFalsy();
  expect(loads.length, "no debería haber una recarga completa de página tras un login fallido").toBe(1);
});

test("2.3 envío con campos vacíos no dispara el login", async ({ page }) => {
  const loginRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/auth/login")) loginRequests.push(req.url());
  });

  await page.goto("/login");
  await getSubmitButton(page).click();

  // El submit nativo debe ser bloqueado por los `required` de los inputs.
  await page.waitForTimeout(500);
  expect(loginRequests).toEqual([]);
  await expect(page).toHaveURL(/\/login$/);
  const emailValid = await getEmailInput(page).evaluate((el: HTMLInputElement) => el.validity.valid);
  expect(emailValid).toBe(false);
});

test("2.4 la sesión persiste al recargar la página tras un login exitoso", async ({ page, userEnsured }) => {
  await page.goto("/login");
  await getEmailInput(page).fill(TEST_USER.email);
  await getPasswordInput(page).fill(TEST_USER.password);
  await getSubmitButton(page).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });

  await page.reload();

  await expect(getLogoutButton(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("2.5 logout borra el token y redirige a login", async ({ page, token }) => {
  await gotoDashboardAuthed(page, token);
  await getLogoutButton(page).click();

  await expect(page).toHaveURL(/\/login$/);
  const storedToken = await page.evaluate(() => window.localStorage.getItem("token"));
  expect(storedToken).toBeFalsy();
});
