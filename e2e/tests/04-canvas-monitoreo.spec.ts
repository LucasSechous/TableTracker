import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  actualizarSector,
  cambiarPosicionMesa,
  desactivarMesa,
  desactivarSector,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  waitForSalonLoaded,
  getSectorBlock,
  getMesaCircle,
  corregirEstadoDesdePanel,
  COLOR_POR_ESTADO,
} from "../fixtures/ui-helpers";
import { BACKEND_URL } from "../playwright.config";

// Sección 4 — Canvas del salón, modo monitoreo

test.describe("con un salón sembrado (1 sector, 4 mesas: una por estado)", () => {
  let sector: SectorResponse;
  let mesas: MesaResponse[];

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Monitoreo ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 40, pos_y: 30, ancho: 500, alto: 300 });
    const estados = ["libre", "ocupada", "pendiente_limpieza", "reservada"];
    // Posiciones distintas para que los círculos (60x60) no se superpongan: por defecto
    // toda mesa nueva nace en pos_x=0/pos_y=0 y quedarían todas apiladas.
    const posiciones = [
      { x: 20, y: 20 },
      { x: 120, y: 20 },
      { x: 20, y: 120 },
      { x: 120, y: 120 },
    ];
    mesas = [];
    for (let i = 0; i < estados.length; i++) {
      let mesa = await createMesa(request, token, { numero: i + 1, sector_id: sector.id, estado: estados[i] });
      mesa = await cambiarPosicionMesa(request, token, mesa.id, posiciones[i].x, posiciones[i].y);
      mesas.push(mesa);
    }
  });

  test.afterEach(async ({ request, token }) => {
    // Soft-delete: algunos tests cambian el estado de una mesa, lo que genera historial y
    // bloquearía un DELETE físico (409, FK con historial_estados). Desactivar no tiene esa
    // restricción y el sector/mesa desactivados dejan de aparecer en el canvas (activo=false).
    for (const mesa of mesas) await desactivarMesa(request, token, mesa.id);
    await desactivarSector(request, token, sector.id);
  });

  test("4.1 carga inicial: sector y mesas se renderizan en su posición guardada", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    await expect(sectorBlock).toBeVisible();
    await expect(sectorBlock).toHaveCSS("left", "40px");
    await expect(sectorBlock).toHaveCSS("top", `${sector.pos_y}px`);

    for (const mesa of mesas) {
      const circle = getMesaCircle(sectorBlock, mesa.numero);
      await expect(circle).toBeVisible();
      const wrapper = circle.locator("xpath=..");
      await expect(wrapper).toHaveCSS("left", `${mesa.pos_x}px`);
      await expect(wrapper).toHaveCSS("top", `${mesa.pos_y}px`);
    }
  });

  test("4.2 cada estado de mesa se refleja con el color correcto", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);

    for (const mesa of mesas) {
      const circle = getMesaCircle(sectorBlock, mesa.numero);
      await expect(circle).toHaveCSS("background-color", COLOR_POR_ESTADO[mesa.estado]);
    }
  });

  test("4.3 click en una mesa en modo monitoreo cambia su estado, no su posición", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);
    const libre = mesas.find((m) => m.estado === "libre")!;
    const circle = getMesaCircle(sectorBlock, libre.numero);
    const wrapper = circle.locator("xpath=..");
    const posAntes = await wrapper.evaluate((el) => ({ left: el.style.left, top: el.style.top }));

    // El click ya no despliega un <select> sobre el canvas: abre PanelMesa, y la
    // corrección manual vive detrás de un desplegable dentro de ese panel (RF-17).
    await circle.click();
    await corregirEstadoDesdePanel(page, "ocupada");

    await expect(circle).toHaveCSS("background-color", COLOR_POR_ESTADO["ocupada"]);
    const posDespues = await wrapper.evaluate((el) => ({ left: el.style.left, top: el.style.top }));
    expect(posDespues).toEqual(posAntes);
  });

  test("4.4 el cambio de estado persiste tras recargar la página", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);
    const libre = mesas.find((m) => m.estado === "libre")!;
    const circle = getMesaCircle(sectorBlock, libre.numero);

    await circle.click();
    await corregirEstadoDesdePanel(page, "reservada");
    await expect(circle).toHaveCSS("background-color", COLOR_POR_ESTADO["reservada"]);

    await page.reload();
    await waitForSalonLoaded(page);
    const sectorBlock2 = getSectorBlock(page, sector.nombre);
    const circle2 = getMesaCircle(sectorBlock2, libre.numero);
    await expect(circle2).toHaveCSS("background-color", COLOR_POR_ESTADO["reservada"]);
  });
});

test("4.5 mesa sin sector asignado — no reproducible vía API/UI", async () => {
  test.skip(
    true,
    "El modelo de datos exige sector_id en toda mesa (POST /mesas devuelve 400 sin sector válido; " +
      "columna sector_id es NOT NULL). No se puede crear una mesa huérfana sin manipular la base " +
      "directamente, lo cual está fuera de alcance. Requiere verificación manual si se cambia el modelo."
  );
});

test("4.6 un salón sin mesas ni sectores se muestra vacío sin errores en consola", async ({ page, token }) => {
  // Se mockean las respuestas para simular un salón vacío sin borrar datos reales de la base.
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  // Se matchea por predicado (no por glob) para cubrir tanto /mesas como /mesas/
  // (FastAPI 307-redirige sin trailing slash) sin afectar /mesas/{id}/estado, etc.
  await page.route(
    (url) => url.origin === BACKEND_URL && /^\/(sectores|mesas)\/?$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, json: [] })
  );

  await gotoDashboardAuthed(page, token);

  await expect(page.getByText(/Error al cargar el salón/i)).not.toBeVisible();
  const circles = page.locator('div[style*="50%"]');
  await expect(circles).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
