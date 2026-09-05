import { test, expect } from "../fixtures/test-fixtures";
import { createSector, desactivarSector, uniqueSuffix, SectorResponse } from "../fixtures/api-helpers";
import { gotoCamarasAuthed } from "../fixtures/ui-helpers";

// Sección 13 — Manejo de errores de la API en la interfaz
//
// Regresión de un bug real: al editar una cámara dejando la contraseña enmascarada («***»),
// el backend responde 422 y el `detail` de FastAPI NO es un string sino una LISTA de objetos
// {type, loc, msg, input, ctx}. El frontend lo metía crudo en el estado de error y React
// tiraba "Objects are not valid as a React child", dejando la pantalla EN BLANCO en vez de
// mostrar el mensaje —que además era un mensaje útil, escrito justo para ese caso.
//
// Lo que se protege acá no es el texto exacto del mensaje, sino que un 422 de validación
// nunca vuelva a romper el render.

test.describe("errores de validación de la API", () => {
  let sector: SectorResponse;

  test.beforeEach(async ({ request, token }) => {
    sector = await createSector(request, token, {
      nombre: `E2E Errores ${uniqueSuffix(test.info().parallelIndex)}`,
    });
  });

  test.afterEach(async ({ request, token }) => {
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("13.1 un 422 al editar una cámara muestra el error y NO deja la página en blanco", async ({
    page,
    token,
  }) => {
    await gotoCamarasAuthed(page, token);

    // Se exige que haya al menos una cámara en vez de saltear el test si no la hay: este
    // es EL test de regresión del bug de la pantalla en blanco, y uno que se auto-saltea
    // se ve verde sin haber probado nada. Si no hay cámaras, el que falla es el entorno y
    // hay que enterarse.
    const filaEditar = page.getByRole("button", { name: "Editar" }).first();
    await expect(filaEditar).toBeVisible();
    await filaEditar.click();
    await expect(page.getByRole("heading", { name: "Editar cámara" })).toBeVisible();

    // El campo viene precargado con la URL enmascarada. Cambiar solo el host y dejar los
    // «***» es lo más natural que puede hacer un usuario, y es exactamente lo que el
    // backend rechaza con 422.
    const inputUrl = page.locator('input[type="text"]').nth(1);
    const original = await inputUrl.inputValue();
    await inputUrl.fill(original.replace(/@[\d.]+:/, "@192.0.2.123:"));

    await page.getByRole("button", { name: "Guardar cambios" }).click();

    // Lo esencial: la aplicación sigue en pie.
    await expect(page.getByRole("heading", { name: "Editar cámara" })).toBeVisible();
    await expect(page.locator("body")).not.toBeEmpty();

    // Y el motivo del rechazo se ve, sin el prefijo "Value error," que agrega Pydantic.
    const cuerpo = await page.locator("body").innerText();
    expect(cuerpo).not.toContain("Value error");
    expect(cuerpo.toLowerCase()).toMatch(/contrase|url/);
  });

  test("13.2 un 422 al crear un sector con nombre duplicado no rompe el modal", async ({ page, token }) => {
    await gotoCamarasAuthed(page, token);
    // Se navega al salón, que es donde se crean sectores desde el modo edición.
    await page.goto("/");
    await page.getByText("Cargando salón...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    await page.getByRole("button", { name: /Editar disposición/ }).click();
    await page.getByRole("button", { name: "+ Nuevo sector" }).click();
    await expect(page.getByRole("heading", { name: /sector/i })).toBeVisible();

    // Un nombre repetido: el backend lo rechaza. Cualquiera sea la forma del detail,
    // la aplicación tiene que seguir viva y decir algo.
    const inputNombre = page.locator("input[type='text']").first();
    await inputNombre.fill(sector.nombre);
    await page.getByRole("button", { name: /Crear|Guardar/ }).first().click();

    await expect(page.locator("body")).not.toBeEmpty();
    // El modal no se cierra ante un error: si se cerrara, el usuario creería que se guardó.
    await expect(page.getByRole("heading", { name: /sector/i })).toBeVisible();
  });
});
