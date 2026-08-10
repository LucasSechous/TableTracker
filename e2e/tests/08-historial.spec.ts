import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  listarHistorial,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoHistorialAuthed,
  getMesaFilterSelect,
  getFechaDesdeInput,
  getFechaHastaInput,
  getBuscarButton,
  getLimpiarFiltrosButton,
  getHistorialRows,
  getHistorialRow,
  ESTADO_LABEL,
} from "../fixtures/ui-helpers";

// Sección 8 — Consulta de historial (T26-89, RF-21)

test.describe("con un sector y dos mesas con historial de estados", () => {
  let sector: SectorResponse;
  let mesaA: MesaResponse;
  let mesaB: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Historial ${suffix}` });
    mesaA = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    mesaB = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "libre" });
    // Cada cambio de estado registra una fila en historial_estados.
    mesaA = await cambiarEstadoMesa(request, token, mesaA.id, "ocupada");
    mesaB = await cambiarEstadoMesa(request, token, mesaB.id, "reservada");
  });

  test.afterEach(async ({ request, token }) => {
    // Soft-delete: los 3 tests cambian el estado de las mesas (para tener historial que
    // consultar), lo que bloquearía un DELETE físico (409, FK con historial_estados).
    await desactivarMesa(request, token, mesaA.id).catch(() => {});
    await desactivarMesa(request, token, mesaB.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("8.1 consultar el historial sin filtros carga y muestra registros", async ({ page, token }) => {
    await gotoHistorialAuthed(page, token);

    await expect(page.getByText("No hay registros de historial para estos filtros.")).toHaveCount(0);
    await expect(getHistorialRow(page, mesaA.id, ESTADO_LABEL.ocupada)).toBeVisible();
    await expect(getHistorialRow(page, mesaB.id, ESTADO_LABEL.reservada)).toBeVisible();
  });

  test("8.2 filtrar historial por mesa específica solo muestra registros de esa mesa", async ({
    page,
    token,
    request,
  }) => {
    await gotoHistorialAuthed(page, token);

    await getMesaFilterSelect(page).selectOption({ label: `Mesa ${mesaA.numero} · ${sector.nombre}` });
    await getBuscarButton(page).click();

    await expect(getHistorialRow(page, mesaA.id, ESTADO_LABEL.ocupada)).toBeVisible();
    await expect(getHistorialRows(page)).toHaveCount(1);
    await expect(getHistorialRow(page, mesaB.id, ESTADO_LABEL.reservada)).toHaveCount(0);

    const historialBackend = await listarHistorial(request, token, { mesa_id: mesaA.id });
    expect(historialBackend.length).toBeGreaterThan(0);
    expect(historialBackend.every((h) => h.mesa_id === mesaA.id)).toBe(true);
  });

  test("8.3 un rango de fechas inválido devuelve 400 y la UI lo maneja sin romperse", async ({ page, token }) => {
    await gotoHistorialAuthed(page, token);

    // fecha_desde posterior a fecha_hasta: el backend responde 400 antes de tocar la base.
    await getFechaDesdeInput(page).fill("2026-08-10");
    await getFechaHastaInput(page).fill("2026-08-01");
    await getBuscarButton(page).click();

    await expect(page.getByText("fecha_inicio no puede ser posterior a fecha_fin")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);

    // La UI sigue viva: el header y los controles de filtro siguen ahí, nada se rompió.
    await expect(page.getByRole("heading", { name: "Historial de mesas" })).toBeVisible();
    await expect(getBuscarButton(page)).toBeEnabled();

    // Y es recuperable: limpiar filtros vuelve a traer el listado sin el error.
    await getLimpiarFiltrosButton(page).click();
    await expect(page.getByText("fecha_inicio no puede ser posterior a fecha_fin")).toHaveCount(0);
    await expect(getHistorialRow(page, mesaA.id, ESTADO_LABEL.ocupada)).toBeVisible();
  });
});
