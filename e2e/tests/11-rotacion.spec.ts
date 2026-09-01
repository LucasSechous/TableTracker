import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  obtenerRotacion,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  gotoRotacionAuthed,
  getRangoDesdeInput,
  getRangoHastaInput,
  getRotacionSectorSelect,
  getRotacionBuscarButton,
  getRotacionLimpiarButton,
  getRotacionFila,
  getRotacionCantidad,
  getRotacionSector,
  getRotacionOrdenarButton,
  getRotacionOrdenFilas,
} from "../fixtures/ui-helpers";

// Sección 11 — Vista de rotación de mesas (T26-159, RF-23)
//
// Igual que en 10-ocupacion.spec.ts, el endpoint agrega sobre TODAS las mesas activas de la
// base, así que no se fijan conteos globales: los asserts se hacen sobre las mesas que crea
// este archivo, ubicadas por su mesa_id en los data-testid de cada fila.
//
// Locators por data-testid, nunca por XPath posicional ni por el texto visible de la celda
// (T26-161, aprendizaje del Sprint 5).

test("11.1 acceder a /rotacion sin sesión redirige a /login", async ({ page }) => {
  await page.goto("/rotacion");
  await expect(page).toHaveURL(/\/login$/);
});

test("11.2 la entrada del menú lateral navega a la vista de rotación", async ({ page, token }) => {
  await gotoDashboardAuthed(page, token);
  await page.getByRole("button", { name: "Abrir menú" }).click();

  const entrada = page.getByRole("button", { name: "Rotación de mesas" });
  await expect(entrada).toBeVisible();
  await entrada.click();

  await expect(page).toHaveURL(/\/rotacion$/);
  await expect(page.getByRole("heading", { name: "Rotación de mesas" })).toBeVisible();
});

test.describe("con mesas que rotaron una cantidad conocida de veces", () => {
  let sector: SectorResponse;
  let mesaDosRotaciones: MesaResponse;
  let mesaUnaRotacion: MesaResponse;
  let mesaSinRotar: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Rotación ${suffix}` });

    // Las mesas se crean libres y después se las hace rotar con transiciones explícitas.
    // Una rotación = transición hacia 'ocupada' desde otro estado (T26-155), así que hay
    // que volver a libre entre medio para que la segunda cuente.
    mesaDosRotaciones = await createMesa(request, token, { numero: 1, sector_id: sector.id });
    await cambiarEstadoMesa(request, token, mesaDosRotaciones.id, "ocupada");
    await cambiarEstadoMesa(request, token, mesaDosRotaciones.id, "libre");
    await cambiarEstadoMesa(request, token, mesaDosRotaciones.id, "ocupada");

    mesaUnaRotacion = await createMesa(request, token, { numero: 2, sector_id: sector.id });
    await cambiarEstadoMesa(request, token, mesaUnaRotacion.id, "ocupada");

    // Reservada NO es ocupada: no debe contar como rotación.
    mesaSinRotar = await createMesa(request, token, { numero: 3, sector_id: sector.id });
    await cambiarEstadoMesa(request, token, mesaSinRotar.id, "reservada");
  });

  test.afterEach(async ({ request, token }) => {
    await desactivarMesa(request, token, mesaDosRotaciones.id).catch(() => {});
    await desactivarMesa(request, token, mesaUnaRotacion.id).catch(() => {});
    await desactivarMesa(request, token, mesaSinRotar.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("11.3 la tabla muestra las rotaciones por mesa y el nombre del sector", async ({ page, token, request }) => {
    const metricas = await obtenerRotacion(request, token, { sector_id: sector.id });
    const porMesa = new Map(metricas.map((m) => [m.mesa_id, m.rotaciones]));

    // Se afirma primero sobre la API: si el backend contara mal, el fallo tiene que
    // señalar al endpoint y no a la tabla.
    expect(porMesa.get(mesaDosRotaciones.id), "libre->ocupada->libre->ocupada son 2 rotaciones").toBe(2);
    expect(porMesa.get(mesaUnaRotacion.id), "una sola transición a ocupada").toBe(1);
    expect(porMesa.get(mesaSinRotar.id), "reservada no es una rotación").toBe(0);

    await gotoRotacionAuthed(page, token);

    for (const mesa of [mesaDosRotaciones, mesaUnaRotacion, mesaSinRotar]) {
      await expect(getRotacionCantidad(page, mesa.id)).toHaveText(String(porMesa.get(mesa.id)));
      // El endpoint devuelve sector_id; la pantalla tiene que resolverlo al nombre.
      await expect(getRotacionSector(page, mesa.id)).toHaveText(sector.nombre);
    }
  });

  test("11.4 filtrar por sector deja solo las mesas de ese sector", async ({ page, token }) => {
    await gotoRotacionAuthed(page, token);

    await getRotacionSectorSelect(page).selectOption(String(sector.id));
    await getRotacionBuscarButton(page).click();

    await expect(getRotacionFila(page, mesaDosRotaciones.id)).toBeVisible();
    await expect(getRotacionFila(page, mesaUnaRotacion.id)).toBeVisible();

    // Todas las filas visibles pertenecen al sector filtrado.
    const filas = await getRotacionOrdenFilas(page);
    expect(filas.length).toBe(3);
    for (const mesa of [mesaDosRotaciones, mesaUnaRotacion, mesaSinRotar]) {
      expect(filas).toContain(`rotacion-fila-${mesa.id}`);
    }

    await getRotacionLimpiarButton(page).click();
    await expect(getRotacionSectorSelect(page)).toHaveValue("");
  });

  test("11.5 la tabla se ordena por rotaciones y el orden se invierte al reclickear", async ({ page, token }) => {
    await gotoRotacionAuthed(page, token);
    await getRotacionSectorSelect(page).selectOption(String(sector.id));
    await getRotacionBuscarButton(page).click();
    await expect(getRotacionFila(page, mesaDosRotaciones.id)).toBeVisible();

    // Orden por defecto: rotaciones descendente, la que más rotó arriba.
    expect(await getRotacionOrdenFilas(page)).toEqual([
      `rotacion-fila-${mesaDosRotaciones.id}`,
      `rotacion-fila-${mesaUnaRotacion.id}`,
      `rotacion-fila-${mesaSinRotar.id}`,
    ]);

    await getRotacionOrdenarButton(page, "rotaciones").click();
    expect(await getRotacionOrdenFilas(page)).toEqual([
      `rotacion-fila-${mesaSinRotar.id}`,
      `rotacion-fila-${mesaUnaRotacion.id}`,
      `rotacion-fila-${mesaDosRotaciones.id}`,
    ]);

    // Por número de mesa ascendente: 1, 2, 3 (el orden en que se crearon).
    await getRotacionOrdenarButton(page, "numero").click();
    expect(await getRotacionOrdenFilas(page)).toEqual([
      `rotacion-fila-${mesaDosRotaciones.id}`,
      `rotacion-fila-${mesaUnaRotacion.id}`,
      `rotacion-fila-${mesaSinRotar.id}`,
    ]);
  });

  test("11.6 el filtro de fechas acota el período contado", async ({ page, token, request }) => {
    // Un rango que termina antes de que existieran estas mesas no puede tener rotaciones
    // suyas: valida que fecha_fin se manda y que el backend la respeta.
    const pasado = await obtenerRotacion(request, token, {
      sector_id: sector.id,
      fecha_inicio: "2020-01-01",
      fecha_fin: "2020-01-02T23:59:59",
    });
    for (const fila of pasado) {
      expect(fila.rotaciones, `la mesa ${fila.mesa_id} no pudo rotar en 2020`).toBe(0);
    }

    await gotoRotacionAuthed(page, token);
    await getRangoDesdeInput(page).fill("2020-01-01");
    await getRangoHastaInput(page).fill("2020-01-02");
    await getRotacionSectorSelect(page).selectOption(String(sector.id));
    await getRotacionBuscarButton(page).click();

    // Las mesas siguen listadas (existen), pero con 0 rotaciones en ese rango.
    await expect(getRotacionCantidad(page, mesaDosRotaciones.id)).toHaveText("0");
    await expect(getRotacionCantidad(page, mesaUnaRotacion.id)).toHaveText("0");
  });
});
