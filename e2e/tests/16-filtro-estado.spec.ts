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
  getSectorBlock,
  getMesaCircle,
  getDashboardEstadoFilter,
  getDashboardEstadoOpciones,
  getDashboardFiltroAviso,
  getDashboardFiltroLimpiar,
  ESTADO_LABEL,
} from "../fixtures/ui-helpers";
import { BACKEND_URL } from "../playwright.config";

// Sección 16 — Filtro de mesas por estado en el canvas (RF-15)
//
// El backend ya aceptaba `?estado=` en GET /mesas mucho antes que esta pantalla: lo que
// faltaba era el control. Por eso los tests miran las dos puntas — que la UI recorte lo
// que se dibuja, y que ese recorte viaje como query param y no se resuelva en el cliente.

const ESTADOS = ["libre", "ocupada", "pendiente_limpieza", "reservada"] as const;

test.describe("con un salón sembrado (1 sector, 4 mesas: una por estado)", () => {
  let sector: SectorResponse;
  let mesas: MesaResponse[];

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Filtro ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 40, pos_y: 30, ancho: 500, alto: 300 });
    // Mismas posiciones separadas que usa 04-canvas-monitoreo: por defecto toda mesa nace
    // en 0,0 y los cuadrados de 60x60 quedarían apilados uno sobre otro.
    const posiciones = [
      { x: 20, y: 20 },
      { x: 120, y: 20 },
      { x: 20, y: 120 },
      { x: 120, y: 120 },
    ];
    mesas = [];
    for (let i = 0; i < ESTADOS.length; i++) {
      let mesa = await createMesa(request, token, { numero: i + 1, sector_id: sector.id, estado: ESTADOS[i] });
      mesa = await cambiarPosicionMesa(request, token, mesa.id, posiciones[i].x, posiciones[i].y);
      mesas.push(mesa);
    }
  });

  test.afterEach(async ({ request, token }) => {
    // Soft-delete por el mismo motivo que en 04: una mesa con historial no admite DELETE
    // físico (409 por la FK con historial_estados).
    for (const mesa of mesas) await desactivarMesa(request, token, mesa.id);
    await desactivarSector(request, token, sector.id);
  });

  test("16.1 el filtro ofrece «Todos» más los cuatro estados, y arranca sin filtrar", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);

    const filtro = getDashboardEstadoFilter(page);
    await expect(filtro).toBeVisible();

    // El value vacío es el "Todos los estados": es lo que el resto de los filtros del
    // proyecto usa para decir "no filtres" (Historial, Rotación).
    expect(await getDashboardEstadoOpciones(page)).toEqual(["", ...ESTADOS]);
    await expect(filtro).toHaveValue("");

    // Cada estado se ofrece con la misma etiqueta que el usuario ve en el resto de la app.
    for (const estado of ESTADOS) {
      await expect(filtro.locator(`option[value="${estado}"]`)).toHaveText(ESTADO_LABEL[estado]);
    }

    // Sin filtro están las cuatro, y no hay aviso de filtrado.
    const sectorBlock = getSectorBlock(page, sector.nombre);
    for (const mesa of mesas) await expect(getMesaCircle(sectorBlock, mesa.numero)).toBeVisible();
    await expect(getDashboardFiltroAviso(page)).toHaveCount(0);
  });

  test("16.2 elegir un estado deja visibles solo las mesas de ese estado", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);

    // Se recorren los cuatro: alcanza con que uno funcione para que el control "ande",
    // pero RF-15 pide los cuatro estados y un enum mal mapeado fallaría solo en alguno.
    for (const estado of ESTADOS) {
      await getDashboardEstadoFilter(page).selectOption(estado);

      const visible = mesas.find((m) => m.estado === estado)!;
      await expect(getMesaCircle(sectorBlock, visible.numero)).toBeVisible();

      for (const otra of mesas.filter((m) => m.estado !== estado)) {
        await expect(getMesaCircle(sectorBlock, otra.numero)).toHaveCount(0);
      }

      await expect(getDashboardFiltroAviso(page)).toContainText(ESTADO_LABEL[estado]);
    }
  });

  test("16.3 volver a «Todos los estados» muestra de nuevo las cuatro mesas", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);

    await getDashboardEstadoFilter(page).selectOption("ocupada");
    const libre = mesas.find((m) => m.estado === "libre")!;
    await expect(getMesaCircle(sectorBlock, libre.numero)).toHaveCount(0);

    await getDashboardEstadoFilter(page).selectOption("");

    for (const mesa of mesas) {
      await expect(getMesaCircle(sectorBlock, mesa.numero)).toBeVisible();
    }
    await expect(getDashboardFiltroAviso(page)).toHaveCount(0);
  });

  test("16.4 el filtro se resuelve en el backend, no recortando en el cliente", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);

    // Que la mesa desaparezca no distingue un filtro server-side de un .filter() en el
    // front. Lo que lo distingue es que el pedido salga con el query param.
    const [request] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().startsWith(`${BACKEND_URL}/mesas`) && req.url().includes("estado=pendiente_limpieza")
      ),
      getDashboardEstadoFilter(page).selectOption("pendiente_limpieza"),
    ]);

    expect(new URL(request.url()).searchParams.get("estado")).toBe("pendiente_limpieza");
  });

  test("16.5 el filtro se limpia al entrar en modo edición", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);

    await getDashboardEstadoFilter(page).selectOption("ocupada");
    await expect(getDashboardFiltroAviso(page)).toBeVisible();

    // Acomodar el salón con mesas escondidas permitiría soltar una encima de otra que no
    // se ve, así que entrar en edición tiene que devolver el salón completo.
    await page.getByRole("button", { name: "Editar disposición" }).click();

    await expect(getDashboardEstadoFilter(page)).toHaveCount(0);
    for (const mesa of mesas) {
      await expect(getMesaCircle(sectorBlock, mesa.numero)).toBeVisible();
    }
  });
});

test("16.6 el atajo «Ver todas» limpia el filtro sin pasar por el desplegable", async ({ page, token, request }) => {
  const suffix = uniqueSuffix(test.info().parallelIndex);
  let sector = await createSector(request, token, { nombre: `E2E Filtro atajo ${suffix}` });
  sector = await actualizarSector(request, token, sector.id, { pos_x: 40, pos_y: 30, ancho: 400, alto: 240 });
  const libre = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
  const ocupada = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "ocupada" });
  await cambiarPosicionMesa(request, token, libre.id, 20, 20);
  await cambiarPosicionMesa(request, token, ocupada.id, 120, 20);

  try {
    await gotoDashboardAuthed(page, token);
    const sectorBlock = getSectorBlock(page, sector.nombre);

    await getDashboardEstadoFilter(page).selectOption("ocupada");
    await expect(getMesaCircle(sectorBlock, libre.numero)).toHaveCount(0);

    await getDashboardFiltroLimpiar(page).click();

    await expect(getDashboardEstadoFilter(page)).toHaveValue("");
    await expect(getMesaCircle(sectorBlock, libre.numero)).toBeVisible();
    await expect(getMesaCircle(sectorBlock, ocupada.numero)).toBeVisible();
  } finally {
    await desactivarMesa(request, token, libre.id);
    await desactivarMesa(request, token, ocupada.id);
    await desactivarSector(request, token, sector.id);
  }
});
