import { test, expect } from "../fixtures/test-fixtures";
import {
  TEST_USER,
  createSector,
  createMesa,
  actualizarSector,
  cambiarPosicionMesa,
  desactivarMesa,
  desactivarSector,
  listarMesas,
  listarSectores,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  getSectorBlock,
  getMesaCircle,
  corregirEstadoDesdePanel,
  cerrarPanelMesa,
  getEmailInput,
  getPasswordInput,
  getSubmitButton,
  COLOR_POR_ESTADO,
} from "../fixtures/ui-helpers";

// Sección 6 — Integración general

test.describe("con un sector y dos mesas", () => {
  let sector: SectorResponse;
  let mesaA: MesaResponse;
  let mesaB: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Integracion ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 20, pos_y: 20, ancho: 600, alto: 350 });
    // Posiciones distintas: toda mesa nueva nace en pos_x=0/pos_y=0 y quedarían apiladas.
    mesaA = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    mesaA = await cambiarPosicionMesa(request, token, mesaA.id, 20, 20);
    mesaB = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "libre" });
    mesaB = await cambiarPosicionMesa(request, token, mesaB.id, 200, 20);
  });

  test.afterEach(async ({ request, token }) => {
    // Soft-delete: 6.1/6.2 cambian el estado de las mesas, lo que genera historial y
    // bloquearía un DELETE físico (409, FK con historial_estados).
    await desactivarMesa(request, token, mesaA.id).catch(() => {});
    await desactivarMesa(request, token, mesaB.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("6.1 flujo completo login -> dashboard -> cambio de estado, sin recargas manuales", async ({ page }) => {
    await page.goto("/login");
    await getEmailInput(page).fill(TEST_USER.email);
    await getPasswordInput(page).fill(TEST_USER.password);
    await getSubmitButton(page).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });

    const sectorBlock = getSectorBlock(page, sector.nombre);
    await expect(sectorBlock).toBeVisible();
    const circle = getMesaCircle(sectorBlock, mesaA.numero);
    await circle.click();
    await corregirEstadoDesdePanel(page, "ocupada");

    await expect(circle).toHaveCSS("background-color", COLOR_POR_ESTADO["ocupada"]);
  });

  test("6.2 cambiar el estado de dos mesas distintas rápidamente no genera pisadas de estado", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);
    const circleA = getMesaCircle(sectorBlock, mesaA.numero);
    const circleB = getMesaCircle(sectorBlock, mesaB.numero);

    // Disparo de los dos cambios sin esperar a que la request de la primera resuelva.
    // Cada mesa se corrige desde su propio PanelMesa: el panel muestra la mesa
    // seleccionada, así que abrir la segunda reemplaza el contenido de la primera.
    await circleA.click();
    await corregirEstadoDesdePanel(page, "ocupada");
    // Hay que cerrar el panel entre una mesa y otra: PanelMesa NO se cierra al corregir
    // el estado, y su overlay tapa el canvas, así que el click en la segunda mesa lo
    // interceptaría el overlay en vez de la mesa.
    await cerrarPanelMesa(page);
    await circleB.click();
    await corregirEstadoDesdePanel(page, "reservada");
    await cerrarPanelMesa(page);

    await expect(circleA).toHaveCSS("background-color", COLOR_POR_ESTADO["ocupada"]);
    await expect(circleB).toHaveCSS("background-color", COLOR_POR_ESTADO["reservada"]);

    await expect
      .poll(async () => {
        const mesas = await listarMesas(request, token, { sector_id: sector.id });
        return {
          a: mesas.find((m) => m.id === mesaA.id)?.estado,
          b: mesas.find((m) => m.id === mesaB.id)?.estado,
        };
      })
      .toEqual({ a: "ocupada", b: "reservada" });
  });

  test("6.3 la app no se rompe en dos viewports distintos", async ({ page, token }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
    ]) {
      const consoleErrors: string[] = [];
      const onErr = (msg: import("@playwright/test").ConsoleMessage) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      };
      page.on("console", onErr);

      await page.setViewportSize(viewport);
      await gotoDashboardAuthed(page, token);

      const sectorBlock = getSectorBlock(page, sector.nombre);
      await expect(sectorBlock).toBeVisible();
      await expect(getMesaCircle(sectorBlock, mesaA.numero)).toBeVisible();

      page.off("console", onErr);
      expect(consoleErrors, `Errores en viewport ${viewport.width}x${viewport.height}`).toEqual([]);
    }
  });

  test("6.4 los datos del canvas coinciden con la respuesta de la API", async ({ page, token, request }) => {
    await gotoDashboardAuthed(page, token);

    const [sectoresApi, mesasApi] = await Promise.all([
      listarSectores(request, token),
      listarMesas(request, token, { sector_id: sector.id }),
    ]);
    const sectorApi = sectoresApi.find((s) => s.id === sector.id)!;

    const sectorBlock = getSectorBlock(page, sectorApi.nombre);
    await expect(sectorBlock).toHaveCSS("left", `${sectorApi.pos_x}px`);
    await expect(sectorBlock).toHaveCSS("top", `${sectorApi.pos_y}px`);

    for (const mesaApiItem of mesasApi) {
      const circle = getMesaCircle(sectorBlock, mesaApiItem.numero);
      await expect(circle).toBeVisible();
      await expect(circle).toHaveCSS("background-color", COLOR_POR_ESTADO[mesaApiItem.estado]);
      const wrapper = circle.locator("xpath=..");
      await expect(wrapper).toHaveCSS("left", `${mesaApiItem.pos_x}px`);
      await expect(wrapper).toHaveCSS("top", `${mesaApiItem.pos_y}px`);
    }
  });
});
