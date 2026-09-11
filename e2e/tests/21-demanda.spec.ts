import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  obtenerDemanda,
  obtenerConfiguracion,
  actualizarConfiguracion,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
  ConfiguracionResponse,
} from "../fixtures/api-helpers";
import { gotoDemandaAuthed, waitForDemandaLoaded } from "../fixtures/ui-helpers";

// Sección 21 — Horarios de mayor demanda (T26-186, RF-24)
//
// El reporte solo devuelve franjas DENTRO del horario de servicio, así que el spec fija su
// propia ventana en vez de confiar en la que esté cargada. Es la lección de 11-rotacion, que
// pasa de día y falla de madrugada porque asume que toda transición cuenta: acá la
// dependencia del horario es de diseño, no de rebote, y dejarla al azar haría que la suite
// fallara sola según la hora a la que corra.
//
// Locators por data-testid (T26-161).

const HORA_ABIERTO = "00:00";
const HORA_CIERRE = "23:59";

test.describe("con una mesa que se ocupó hoy", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;
  let configPrevia: ConfiguracionResponse;
  let hoy: string;

  test.beforeEach(async ({ request, token }) => {
    configPrevia = await obtenerConfiguracion(request, token);
    // Ventana abierta todo el día: así la franja de "ahora" siempre está dentro del reporte,
    // corra el test a la hora que corra.
    await actualizarConfiguracion(request, token, {
      hora_apertura: HORA_ABIERTO,
      hora_cierre: HORA_CIERRE,
    });

    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Demanda ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    await cambiarEstadoMesa(request, token, mesa.id, "ocupada");

    // La fecha del reporte es la del reloj del LOCAL, no la del navegador ni UTC.
    hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date());
  });

  test.afterEach(async ({ request, token }) => {
    await actualizarConfiguracion(request, token, {
      hora_apertura: configPrevia.hora_apertura ?? undefined,
      hora_cierre: configPrevia.hora_cierre ?? undefined,
    }).catch(() => {});
    await desactivarMesa(request, token, mesa.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("21.1 acceder a /demanda sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/demanda");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("21.2 la vista refleja lo que devuelve GET /metricas/demanda", async ({ page, token, request }) => {
    const datos = await obtenerDemanda(request, token, { fecha_inicio: hoy, fecha_fin: hoy });
    // Se afirma primero sobre la API: si el backend agregara mal, el fallo tiene que señalar
    // al endpoint y no a la tabla.
    expect(datos.dias).toBe(1);
    expect(datos.franjas.length).toBeGreaterThan(0);

    await gotoDemandaAuthed(page, token);
    await page.getByTestId("rango-fechas-desde").fill(hoy);
    await page.getByTestId("rango-fechas-hasta").fill(hoy);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/metricas/demanda") && r.status() === 200),
      page.getByTestId("demanda-buscar").click(),
    ]);
    await waitForDemandaLoaded(page);

    // Una fila y una barra por franja devuelta, ni más ni menos.
    await expect(page.locator('[data-testid^="demanda-fila-"]')).toHaveCount(datos.franjas.length);
    await expect(page.locator('[data-testid^="demanda-franja-"]')).toHaveCount(datos.franjas.length);

    // Y el porcentaje de una franja concreta coincide con el de la API.
    const primera = datos.franjas[0];
    await expect(page.getByTestId(`demanda-fila-${primera.hora}`)).toContainText(
      `${primera.porcentaje_ocupacion}%`
    );
  });

  test("21.3 las franjas quedan dentro del horario de servicio", async ({ token, request }) => {
    // Con una ventana acotada el reporte habla de esas horas y de ninguna otra: una hora con
    // el local cerrado no es 0% de ocupación, es una hora sobre la que no hay nada que decir.
    await actualizarConfiguracion(request, token, { hora_apertura: "10:00", hora_cierre: "14:00" });

    const datos = await obtenerDemanda(request, token, { fecha_inicio: hoy, fecha_fin: hoy });
    const horas = datos.franjas.map((f) => f.hora);
    expect(horas.every((h) => h >= 10 && h < 14)).toBe(true);
    expect(horas).not.toContain(3);
  });

  test("21.4 un rango de un solo día avisa que la muestra es chica", async ({ page, token }) => {
    // El ticket pide documentar la limitación en vez de sobre-interpretar: el aviso es parte
    // del entregable, no un adorno.
    await gotoDemandaAuthed(page, token);
    await page.getByTestId("rango-fechas-desde").fill(hoy);
    await page.getByTestId("rango-fechas-hasta").fill(hoy);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/metricas/demanda") && r.status() === 200),
      page.getByTestId("demanda-buscar").click(),
    ]);
    await waitForDemandaLoaded(page);

    await expect(page.getByTestId("demanda-aviso-muestra")).toBeVisible();
  });

  test("21.5 un rango sin datos muestra un vacío explícito, no un gráfico plano", async ({ page, token }) => {
    await gotoDemandaAuthed(page, token);
    await page.getByTestId("rango-fechas-desde").fill("2027-01-01");
    await page.getByTestId("rango-fechas-hasta").fill("2027-01-07");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/metricas/demanda") && r.status() === 200),
      page.getByTestId("demanda-buscar").click(),
    ]);
    await waitForDemandaLoaded(page);

    await expect(page.getByTestId("demanda-sin-datos")).toBeVisible();
    await expect(page.locator('[data-testid^="demanda-franja-"]')).toHaveCount(0);
  });

  test("21.6 el filtro de sector acota lo medido", async ({ page, token, request }) => {
    const todos = await obtenerDemanda(request, token, { fecha_inicio: hoy, fecha_fin: hoy });
    const soloSector = await obtenerDemanda(request, token, {
      fecha_inicio: hoy,
      fecha_fin: hoy,
      sector_id: sector.id,
    });

    const medidosTodos = todos.franjas.reduce((a, f) => a + f.minutos_medidos, 0);
    const medidosSector = soloSector.franjas.reduce((a, f) => a + f.minutos_medidos, 0);
    // El salón entero tiene más mesas que este sector de una sola mesa.
    expect(medidosSector).toBeLessThan(medidosTodos);

    await gotoDemandaAuthed(page, token);
    await expect(page.getByTestId("demanda-filtro-sector")).toBeVisible();
  });
});
