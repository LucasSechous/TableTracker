import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  actualizarSector,
  cambiarPosicionMesa,
  deleteMesa,
  deleteSector,
  listarMesas,
  listarSectores,
  obtenerConfiguracion,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  waitForSalonLoaded,
  getSectorBlock,
  getMesaCircle,
  getResizeHandle,
  getPanelMesaToggle,
  cerrarPanelMesa,
  getToggleModoButton,
  entrarEnModoEdicion,
  dragBy,
} from "../fixtures/ui-helpers";

// Diámetro de mesa (constants.ts del frontend); duplicado acá para no acoplar los
// tests a un import del código de la app, igual que el resto del archivo hardcodea
// las dimensiones del canvas/sector.
const DIAMETRO_MESA = 60;

// Margen que se le deja al sector de 5.8 contra el borde del salón: al agrandarlo con el
// handle no debería poder crecer más que esto. Tiene que ser mayor que el tamaño inicial
// del sector (150x80) para que el clamp sea lo que lo detiene y no su propio tamaño.
const MARGEN_PARA_CRECER_X = 200;
const MARGEN_PARA_CRECER_Y = 100;

// Sección 5 — Canvas del salón, modo edición

// Delega en el helper compartido: entrar en edición dejó de ser un toggle de un solo
// botón y la lógica no debería estar duplicada en cada spec.
const toggleAEdicion = entrarEnModoEdicion;

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

    // En monitoreo (modo por defecto), el click abre PanelMesa con el detalle de la
    // mesa. Antes abría un <select> inline sobre el canvas; el rediseño del Sprint 6/7
    // lo reemplazó por el panel lateral, pero lo que se prueba acá sigue siendo lo
    // mismo: que el click en monitoreo consulte y en edición no.
    await expect(getToggleModoButton(page)).toHaveText(/Editar disposición/);
    await circle.click();
    await expect(getPanelMesaToggle(page)).toBeVisible();
    await cerrarPanelMesa(page);

    await toggleAEdicion(page);

    // En edición, el mismo click NO debe abrir el panel: ahí el click arrastra.
    await circle.click();
    await expect(getPanelMesaToggle(page)).toHaveCount(0);
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

    // La mesa sigue existiendo (no se pierde ni rompe el render). No queda afuera del
    // sector ni recortada por el overflow:hidden del canvas: MesaVisual clampea pos_x/pos_y
    // dentro de [0, ancho/alto del sector - DIAMETRO_MESA] durante el propio drag
    // (MesaVisual.tsx:57-61), así que soltarla "afuera" la deja pegada al borde del sector.
    await page.reload();
    await waitForSalonLoaded(page);
    const mesasBackend = await listarMesas(request, token, { sector_id: sector.id });
    const mesaActualizada = mesasBackend.find((m) => m.id === mesa.id);
    expect(mesaActualizada, "la mesa debe seguir existiendo en el backend tras soltarla fuera de límites").toBeTruthy();
    expect(mesaActualizada!.pos_x).toBe(sector.ancho - DIAMETRO_MESA);
    expect(mesaActualizada!.pos_y).toBe(sector.alto - DIAMETRO_MESA);

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

test.describe("con un sector cerca del borde inferior derecho del canvas", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Resize Borde Canvas ${suffix}` });
    // La posición se calcula desde el tamaño REAL del salón, no desde un 1200x700
    // hardcodeado: el tamaño del canvas es estado global persistido y cualquiera puede
    // haberlo cambiado arrastrando el borde. Con el valor fijo, el sector terminaba
    // colocado fuera del salón y el margen para crecer daba negativo.
    const { ancho_salon, alto_salon } = await obtenerConfiguracion(request, token);
    sector = await actualizarSector(request, token, sector.id, {
      pos_x: ancho_salon - MARGEN_PARA_CRECER_X,
      pos_y: alto_salon - MARGEN_PARA_CRECER_Y,
      ancho: 150,
      alto: 80,
    });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
  });

  test.afterEach(async ({ request, token }) => {
    await deleteMesa(request, token, mesa.id).catch(() => {});
    await deleteSector(request, token, sector.id).catch(() => {});
  });

  test("5.8 agrandar un sector con el handle no lo saca del canvas", async ({ page, token, request }) => {
    // El tamaño del salón se lee de la API en vez de hardcodear 1200x700: es estado
    // global persistido y cualquier resize del canvas —por la UI o por otro test— lo
    // cambia para siempre. Este test fallaba con "expected 200, received 241" porque
    // el salón había quedado en 1241 de ancho, y lo que estaba mal era la constante
    // del test, no el clamping de la aplicación.
    const { ancho_salon, alto_salon } = await obtenerConfiguracion(request, token);
    const anchoEsperado = ancho_salon - sector.pos_x;
    const altoEsperado = alto_salon - sector.pos_y;

    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    const handle = getResizeHandle(sectorBlock);
    await expect(handle).toBeVisible();

    const [patchRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/sectores/${sector.id}`) && req.method() === "PATCH"),
      dragBy(page, handle, 1000, 1000),
    ]);
    const payload = patchRequest.postDataJSON() as { ancho: number; alto: number };
    expect(payload.ancho).toBe(anchoEsperado);
    expect(payload.alto).toBe(altoEsperado);

    await page.reload();
    await waitForSalonLoaded(page);
    const sectoresBackend = await listarSectores(request, token);
    const sectorActualizado = sectoresBackend.find((s) => s.id === sector.id)!;
    expect(sectorActualizado.ancho).toBe(anchoEsperado);
    expect(sectorActualizado.alto).toBe(altoEsperado);
    expect(sectorActualizado.pos_x + sectorActualizado.ancho).toBeLessThanOrEqual(ancho_salon);
    expect(sectorActualizado.pos_y + sectorActualizado.alto).toBeLessThanOrEqual(alto_salon);
  });
});

test.describe("con un sector vacío (sin mesas)", () => {
  let sector: SectorResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Resize Vacio ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 50, pos_y: 50, ancho: 300, alto: 300 });
  });

  test.afterEach(async ({ request, token }) => {
    await deleteSector(request, token, sector.id).catch(() => {});
  });

  test("5.9 achicar un sector vacío hasta el mínimo no lo colapsa a 0 ni negativo", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    const handle = getResizeHandle(sectorBlock);

    const [patchRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/sectores/${sector.id}`) && req.method() === "PATCH"),
      dragBy(page, handle, -1000, -1000),
    ]);
    const payload = patchRequest.postDataJSON() as { ancho: number; alto: number };
    expect(payload.ancho).toBeGreaterThan(0);
    expect(payload.alto).toBeGreaterThan(0);

    await page.reload();
    await waitForSalonLoaded(page);
    const sectoresBackend = await listarSectores(request, token);
    const sectorActualizado = sectoresBackend.find((s) => s.id === sector.id)!;
    expect(sectorActualizado.ancho).toBe(payload.ancho);
    expect(sectorActualizado.alto).toBe(payload.alto);
    expect(sectorActualizado.ancho).toBeGreaterThan(0);
    expect(sectorActualizado.alto).toBeGreaterThan(0);
  });
});

test.describe("con un sector y una mesa cerca del borde inferior derecho", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Resize Mesa Borde ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 50, pos_y: 50, ancho: 400, alto: 300 });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    mesa = await cambiarPosicionMesa(request, token, mesa.id, 300, 200);
  });

  test.afterEach(async ({ request, token }) => {
    await deleteMesa(request, token, mesa.id).catch(() => {});
    await deleteSector(request, token, sector.id).catch(() => {});
  });

  test("5.10 achicar un sector no puede dejar sus mesas fuera del nuevo tamaño", async ({ page, token, request }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    const handle = getResizeHandle(sectorBlock);

    const [patchRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/sectores/${sector.id}`) && req.method() === "PATCH"),
      dragBy(page, handle, -1000, -1000),
    ]);
    const payload = patchRequest.postDataJSON() as { ancho: number; alto: number };
    // El límite de achique es exactamente el espacio que ocupa la mesa (pos + diámetro).
    expect(payload.ancho).toBe(mesa.pos_x + DIAMETRO_MESA);
    expect(payload.alto).toBe(mesa.pos_y + DIAMETRO_MESA);

    await page.reload();
    await waitForSalonLoaded(page);
    const mesasBackend = await listarMesas(request, token, { sector_id: sector.id });
    const sectoresBackend = await listarSectores(request, token);
    const mesaBackend = mesasBackend.find((m) => m.id === mesa.id)!;
    const sectorBackend = sectoresBackend.find((s) => s.id === sector.id)!;
    // Comparado contra la posición real de la mesa persistida en Supabase: nunca queda afuera.
    expect(mesaBackend.pos_x + DIAMETRO_MESA).toBeLessThanOrEqual(sectorBackend.ancho);
    expect(mesaBackend.pos_y + DIAMETRO_MESA).toBeLessThanOrEqual(sectorBackend.alto);
  });
});
