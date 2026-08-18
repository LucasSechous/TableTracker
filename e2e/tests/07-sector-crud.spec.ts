import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
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

  test("7.3 eliminar un sector CON mesas lo desactiva sin romper la UI (soft-delete, ya no bloquea por mesas asociadas)", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    await toggleAEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);

    page.once("dialog", (dialog) => dialog.accept());
    await getEliminarSectorButton(sectorBlock).click();

    // El botón desactiva (PATCH activo=false) en vez de un DELETE físico, así que ya no hay
    // restricción por mesas asociadas: el sector desaparece del canvas sin recargar.
    await expect(getSectorBlock(page, sector.nombre)).toHaveCount(0);

    const sectoresBackend = await listarSectores(request, token);
    expect(sectoresBackend.find((s) => s.id === sector.id)).toBeUndefined();

    const sectoresInactivos = await listarSectores(request, token, { incluir_inactivos: true });
    expect(sectoresInactivos.find((s) => s.id === sector.id)?.activo).toBe(false);

    // La mesa no se pierde: sigue activa, solo su sector quedó desactivado.
    const mesasBackend = await listarMesas(request, token, { sector_id: sector.id });
    expect(mesasBackend.find((m) => m.id === mesa.id)?.activa).toBe(true);
  });
});
