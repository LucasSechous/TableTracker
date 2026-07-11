import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  actualizarSector,
  deleteMesa,
  deleteSector,
  listarMesas,
  listarSectores,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  waitForSalonLoaded,
  getSectorBlock,
  getMesaCircle,
  getEstadoSelect,
  getToggleModoButton,
  dragBy,
} from "../fixtures/ui-helpers";

// Sección 5 — Canvas del salón, modo edición

async function toggleAEdicion(page: import("@playwright/test").Page) {
  await getToggleModoButton(page).click();
  await expect(getToggleModoButton(page)).toHaveText(/Ver monitoreo/);
}

test.describe("con un sector (700x400) y una mesa cerca de la esquina", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Edicion ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 50, pos_y: 50, ancho: 700, alto: 400 });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
  });

  test.afterEach(async ({ request, token }) => {
    await deleteMesa(request, token, mesa.id).catch(() => {});
    await deleteSector(request, token, sector.id).catch(() => {});
  });

  test("5.1 el toggle monitoreo/edición cambia el comportamiento del click", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);
    const circle = getMesaCircle(sectorBlock, mesa.numero);

    // En monitoreo (modo por defecto), el click abre el select de estado.
    await expect(getToggleModoButton(page)).toHaveText(/Editar disposición/);
    await circle.click();
    await expect(getEstadoSelect(circle)).toBeVisible();
    await page.mouse.click(10, 10); // cierra el select clickeando afuera

    await toggleAEdicion(page);

    // En edición, el mismo click NO debe abrir el select.
    await circle.click();
    await expect(getEstadoSelect(circle)).toHaveCount(0);
  });

  test("5.2 arrastrar una mesa la mueve visualmente", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    const circle = getMesaCircle(sectorBlock, mesa.numero);
    const wrapper = circle.locator("xpath=..");
    const antes = await wrapper.boundingBox();
    expect(antes).not.toBeNull();

    await dragBy(page, circle, 80, 40);

    const despues = await wrapper.boundingBox();
    expect(despues).not.toBeNull();
    expect(Math.round(despues!.x - antes!.x)).toBeCloseTo(80, -1);
    expect(Math.round(despues!.y - antes!.y)).toBeCloseTo(40, -1);
  });

  test("5.3 soltar una mesa dentro del sector actualiza pos_x/pos_y y lo persiste", async ({ page, token, request }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    const circle = getMesaCircle(sectorBlock, mesa.numero);

    const [patchRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/mesas/${mesa.id}/posicion`) && req.method() === "PATCH"),
      dragBy(page, circle, 60, 25),
    ]);
    const payload = patchRequest.postDataJSON() as { pos_x: number; pos_y: number };
    expect(payload.pos_x).toBe(mesa.pos_x + 60);
    expect(payload.pos_y).toBe(mesa.pos_y + 25);

    await page.reload();
    await waitForSalonLoaded(page);
    const mesasBackend = await listarMesas(request, token, { sector_id: sector.id });
    const mesaActualizada = mesasBackend.find((m) => m.id === mesa.id)!;
    expect(mesaActualizada.pos_x).toBe(mesa.pos_x + 60);
    expect(mesaActualizada.pos_y).toBe(mesa.pos_y + 25);
  });

  test("5.4 soltar una mesa fuera de los límites del sector/canvas no la destruye", async ({ page, token, request }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    const circle = getMesaCircle(sectorBlock, mesa.numero);

    // Se suelta bien afuera del sector (700x400) y del canvas (1200x700).
    const [patchRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/mesas/${mesa.id}/posicion`) && req.method() === "PATCH"),
      dragBy(page, circle, 1400, 900),
    ]);
    const patchResponse = await patchRequest.response();
    expect(patchResponse?.ok()).toBe(true);

    // La mesa sigue existiendo (no se pierde ni rompe el render), aunque quede
    // visualmente recortada por el overflow:hidden del canvas.
    await page.reload();
    await waitForSalonLoaded(page);
    const mesasBackend = await listarMesas(request, token, { sector_id: sector.id });
    const mesaActualizada = mesasBackend.find((m) => m.id === mesa.id);
    expect(mesaActualizada, "la mesa debe seguir existiendo en el backend tras soltarla fuera de límites").toBeTruthy();
    expect(mesaActualizada!.pos_x).toBeGreaterThan(sector.ancho);

    const sectorBlockAfter = getSectorBlock(page, sector.nombre);
    await expect(sectorBlockAfter).toBeVisible();
    const circleAfter = getMesaCircle(sectorBlockAfter, mesa.numero);
    // Sigue en el DOM (aunque pueda no ser visible por el clipping del canvas).
    await expect(circleAfter).toHaveCount(1);
  });

  test("5.5 arrastrar el SectorBloque reposiciona el sector junto con sus mesas", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    const circle = getMesaCircle(sectorBlock, mesa.numero);

    const sectorAntes = await sectorBlock.boundingBox();
    const mesaAntes = await circle.boundingBox();
    const mesaEstiloAntes = await circle.locator("xpath=..").evaluate((el) => el.style.left + "," + el.style.top);

    // Se arrastra desde el centro del bloque de sector, lejos de la mesa (que está cerca de la esquina).
    await dragBy(page, sectorBlock, 90, 45);

    const sectorDespues = await sectorBlock.boundingBox();
    const mesaDespues = await circle.boundingBox();
    const mesaEstiloDespues = await circle.locator("xpath=..").evaluate((el) => el.style.left + "," + el.style.top);

    expect(Math.round(sectorDespues!.x - sectorAntes!.x)).toBeCloseTo(90, -1);
    expect(Math.round(sectorDespues!.y - sectorAntes!.y)).toBeCloseTo(45, -1);
    // La mesa se mueve junto con el sector en coordenadas de página...
    expect(Math.round(mesaDespues!.x - mesaAntes!.x)).toBeCloseTo(90, -1);
    expect(Math.round(mesaDespues!.y - mesaAntes!.y)).toBeCloseTo(45, -1);
    // ...pero su posición propia (relativa al sector) no cambia.
    expect(mesaEstiloDespues).toBe(mesaEstiloAntes);
  });

  test("5.6 la nueva posición del sector persiste tras recargar", async ({ page, token, request }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);
    const sectorBlock = getSectorBlock(page, sector.nombre);

    const [patchRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/sectores/${sector.id}`) && req.method() === "PATCH"),
      dragBy(page, sectorBlock, 70, 35),
    ]);
    const payload = patchRequest.postDataJSON() as { pos_x: number; pos_y: number };

    await page.reload();
    await waitForSalonLoaded(page);
    const sectoresBackend = await listarSectores(request, token);
    const sectorActualizado = sectoresBackend.find((s) => s.id === sector.id)!;
    expect(sectorActualizado.pos_x).toBe(payload.pos_x);
    expect(sectorActualizado.pos_y).toBe(payload.pos_y);

    const sectorBlockAfter = getSectorBlock(page, sector.nombre);
    await expect(sectorBlockAfter).toHaveCSS("left", `${payload.pos_x}px`);
    await expect(sectorBlockAfter).toHaveCSS("top", `${payload.pos_y}px`);
  });

  test("5.7 en modo monitoreo, intentar arrastrar una mesa no debe moverla", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    // Modo monitoreo es el default: no se hace toggle.
    const sectorBlock = getSectorBlock(page, sector.nombre);
    const circle = getMesaCircle(sectorBlock, mesa.numero);
    const wrapper = circle.locator("xpath=..");
    const antes = await wrapper.boundingBox();

    await dragBy(page, circle, 80, 40);

    const despues = await wrapper.boundingBox();
    expect(despues!.x).toBeCloseTo(antes!.x, 0);
    expect(despues!.y).toBeCloseTo(antes!.y, 0);
  });
});
