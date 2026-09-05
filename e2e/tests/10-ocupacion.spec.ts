import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  desactivarMesa,
  desactivarSector,
  obtenerOcupacion,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  gotoOcupacionAuthed,
  getOcupacionCardCount,
  getOcupacionCardSwatch,
  getOcupacionCardEtiqueta,
  getOcupacionPorcentaje,
  getOcupacionResumen,
  getOcupacionTotal,
  getOcupacionNotaPorcentaje,
  getOcupacionNotaReservada,
  ESTADOS_OCUPACION,
  ETIQUETA_CARD_OCUPACION,
  COLOR_POR_ESTADO,
} from "../fixtures/ui-helpers";

// Sección 10 — Panel de métricas de ocupación (T26-158, RF-22)
//
// El endpoint agrega sobre TODAS las mesas activas de la base, no solo las que crea este
// archivo, así que los conteos absolutos no son predecibles. En vez de fijar números
// esperados, cada assert compara la UI contra lo que devuelve GET /metricas/ocupacion en
// ese mismo momento: lo que se prueba es que el panel refleje la respuesta, no que la base
// tenga N mesas.

test("10.1 acceder a /ocupacion sin sesión redirige a /login", async ({ page }) => {
  // La ruta va solo detrás de PrivateRoute (sin AdminRoute, a diferencia de /camaras): el
  // panel lo ven todos los roles. Este assert cubre que no me haya olvidado de envolverla.
  await page.goto("/ocupacion");
  await expect(page).toHaveURL(/\/login$/);
});

test("10.2 la entrada del menú lateral navega al panel de ocupación", async ({ page, token }) => {
  await gotoDashboardAuthed(page, token);
  await page.getByRole("button", { name: "Abrir menú" }).click();

  // Que la entrada se vea para un rol no-admin no se puede afirmar acá: TEST_USER es admin y
  // no hay endpoint para borrar usuarios (ver 09-calibracion-roi.spec.ts), así que crear un
  // mozo de prueba lo dejaría permanentemente en la base real. Lo que sí se verifica es que
  // convive con "Ver historial", la otra entrada sin gate de admin.
  await expect(page.getByRole("button", { name: "Ver historial" })).toBeVisible();
  const entradaOcupacion = page.getByRole("button", { name: "Ocupación del salón" });
  await expect(entradaOcupacion).toBeVisible();

  await entradaOcupacion.click();

  await expect(page).toHaveURL(/\/ocupacion$/);
  await expect(page.getByRole("heading", { name: "Ocupación del salón" })).toBeVisible();
});

test.describe("con un sector y tres mesas en estados distintos", () => {
  let sector: SectorResponse;
  let mesaOcupada: MesaResponse;
  let mesaReservada: MesaResponse;
  let mesaLibre: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Ocupación ${suffix}` });
    // Una ocupada y una reservada como mínimo: son los dos estados que el panel tiene que
    // mostrar sin mezclar (la reservada no entra en el %).
    mesaOcupada = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "ocupada" });
    mesaReservada = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "reservada" });
    mesaLibre = await createMesa(request, token, { numero: 3, sector_id: sector.id, estado: "libre" });
  });

  test.afterEach(async ({ request, token }) => {
    // Soft-delete: las mesas se crean ya con estado, lo que puede haber generado historial y
    // bloquearía un DELETE físico (409, FK con historial_estados).
    await desactivarMesa(request, token, mesaOcupada.id).catch(() => {});
    await desactivarMesa(request, token, mesaReservada.id).catch(() => {});
    await desactivarMesa(request, token, mesaLibre.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("10.3 el panel muestra el % y una card por estado, con los mismos colores que el salón", async ({
    page,
    token,
    request,
  }) => {
    const metricas = await obtenerOcupacion(request, token);
    const conteo = metricas.conteo_por_estado;
    expect(metricas.total_mesas, "el sector recién creado aporta 3 mesas activas").toBeGreaterThanOrEqual(3);

    await gotoOcupacionAuthed(page, token);

    await expect(page.getByRole("heading", { name: "Ocupación del salón" })).toBeVisible();
    await expect(getOcupacionPorcentaje(page)).toHaveText(`${metricas.porcentaje_ocupacion}%`);
    await expect(getOcupacionResumen(page)).toHaveText(
      `${conteo.ocupada} de ${metricas.total_mesas} mesas ocupadas`
    );
    await expect(getOcupacionTotal(page)).toHaveText(`${metricas.total_mesas} mesas activas en total`);

    for (const estado of ESTADOS_OCUPACION) {
      await expect(getOcupacionCardEtiqueta(page, estado)).toHaveText(ETIQUETA_CARD_OCUPACION[estado]);
      await expect(getOcupacionCardCount(page, estado)).toHaveText(String(conteo[estado]));
      // El ticket pide reutilizar COLOR_POR_ESTADO en vez de definir una paleta nueva: si el
      // panel se hubiera armado su propio set de colores, este assert lo detecta.
      await expect(getOcupacionCardSwatch(page, estado)).toHaveCSS("background-color", COLOR_POR_ESTADO[estado]);
    }
  });

  test("10.4 el panel deja explícito que las mesas reservadas no suman al % de ocupación", async ({
    page,
    token,
    request,
  }) => {
    const metricas = await obtenerOcupacion(request, token);
    const conteo = metricas.conteo_por_estado;
    expect(conteo.reservada, "el beforeEach dejó al menos una mesa reservada").toBeGreaterThan(0);

    // Invariante de T26-154 que el panel comunica: el % sale solo de las ocupadas. Si el
    // backend algún día sumara las reservadas, esto falla acá y no en la lectura del panel.
    const esperado = Math.round((conteo.ocupada / metricas.total_mesas) * 100 * 100) / 100;
    expect(metricas.porcentaje_ocupacion).toBeCloseTo(esperado, 2);

    await gotoOcupacionAuthed(page, token);

    // Dos avisos, en los dos lugares donde se puede leer mal: pegado al % y en la card.
    await expect(getOcupacionNotaPorcentaje(page)).toContainText("solo las mesas ocupadas");
    await expect(getOcupacionNotaPorcentaje(page)).toContainText("Las reservadas no suman");
    await expect(getOcupacionNotaReservada(page)).toHaveText("No suman al % de ocupación");
  });
});
