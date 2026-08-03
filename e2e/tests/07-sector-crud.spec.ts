import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  deleteMesa,
  deleteSector,
  listarSectores,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  getSectorBlock,
  getEditarSectorButton,
  getEliminarSectorButton,
  getToggleModoButton,
} from "../fixtures/ui-helpers";

// Sección 7 — Edición y eliminación de sectores (T26-120/T26-121)

async function toggleAEdicion(page: import("@playwright/test").Page) {
  await getToggleModoButton(page).click();
  await expect(getToggleModoButton(page)).toHaveText(/Ver monitoreo/);
}

test.describe("con un sector vacío (sin mesas)", () => {
  let sector: SectorResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E CRUD Vacio ${suffix}` });
  });

  test.afterEach(async ({ request, token }) => {
    await deleteSector(request, token, sector.id).catch(() => {});
  });

  test("7.1 editar el nombre de un sector se refleja sin recargar", async ({ page, token, request }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    await getEditarSectorButton(sectorBlock).click();

    const nuevoNombre = `${sector.nombre} Editado`;
    await expect(page.getByLabel("Nombre")).toHaveValue(sector.nombre);
    await page.getByLabel("Nombre").fill(nuevoNombre);
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    // Sin recarga: el bloque ya muestra el nuevo nombre.
    await expect(page.getByText(nuevoNombre, { exact: true })).toBeVisible();
    await expect(page.getByText(sector.nombre, { exact: true })).toHaveCount(0);

    const sectoresBackend = await listarSectores(request, token);
    const sectorActualizado = sectoresBackend.find((s) => s.id === sector.id)!;
    expect(sectorActualizado.nombre).toBe(nuevoNombre);
    sector = sectorActualizado; // para que el afterEach borre con el nombre correcto
  });

  test("7.2 crear un sector vacío y eliminarlo lo hace desaparecer del canvas sin recargar", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    await expect(sectorBlock).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await getEliminarSectorButton(sectorBlock).click();

    await expect(getSectorBlock(page, sector.nombre)).toHaveCount(0);

    const sectoresBackend = await listarSectores(request, token);
    expect(sectoresBackend.find((s) => s.id === sector.id)).toBeUndefined();
  });
});

test.describe("con un sector y una mesa", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E CRUD ConMesa ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
  });

  test.afterEach(async ({ request, token }) => {
    await deleteMesa(request, token, mesa.id).catch(() => {});
    await deleteSector(request, token, sector.id).catch(() => {});
  });

  test("7.3 intentar eliminar un sector CON mesas muestra el error del backend sin romper la UI", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);

    const dialogs: { type: string; message: string }[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });

    await getEliminarSectorButton(sectorBlock).click();

    await expect.poll(() => dialogs.length).toBeGreaterThanOrEqual(2);
    expect(dialogs[0].type).toBe("confirm");
    expect(dialogs[1].type).toBe("alert");
    expect(dialogs[1].message).toContain("No se puede eliminar un sector con mesas asociadas");

    // La UI no se rompe: el sector y su mesa siguen ahí.
    await expect(sectorBlock).toBeVisible();

    const sectoresBackend = await listarSectores(request, token);
    expect(sectoresBackend.find((s) => s.id === sector.id)).toBeTruthy();
  });
});
