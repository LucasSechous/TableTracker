import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  obtenerConfiguracion,
  actualizarConfiguracion,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
  ConfiguracionResponse,
} from "../fixtures/api-helpers";
import { gotoDashboardAuthed, getSectorBlock, getMesaCircle } from "../fixtures/ui-helpers";

// Sección 15 — Aviso de limpieza demorada (T26-173)
//
// El aviso depende del tiempo transcurrido, así que en vez de esperar minutos reales se
// adelanta el reloj del navegador con page.clock. El cálculo de minutos vive en el cliente
// (minutosEnEstado, constants.ts) y lee Date.now(), que es justamente lo que el reloj
// simulado controla. Sin esto el test tardaría más que el umbral que quiere probar.
//
// Locators por data-testid (T26-161).

const UMBRAL_MINUTOS = 15;

test.describe("con una mesa pendiente de limpieza", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;
  let configPrevia: ConfiguracionResponse;

  test.beforeEach(async ({ request, token }) => {
    configPrevia = await obtenerConfiguracion(request, token);
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Limpieza ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    // Vía el endpoint de estado, que es el que mueve estado_desde.
    await cambiarEstadoMesa(request, token, mesa.id, "pendiente_limpieza");
  });

  test.afterEach(async ({ request, token }) => {
    // El umbral es configuración global: si se dejara puesto, contaminaría al resto de la
    // suite marcando mesas de otros tests como atrasadas.
    await actualizarConfiguracion(request, token, {
      minutos_limpieza_demorada: configPrevia.minutos_limpieza_demorada ?? undefined,
    }).catch(() => {});
    await desactivarMesa(request, token, mesa.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("15.1 sin umbral configurado no se marca ninguna mesa", async ({ page, token, request }) => {
    // Se fuerza el apagado en la base, no se asume: otra corrida pudo dejarlo puesto.
    await actualizarConfiguracion(request, token, {}).catch(() => {});
    const config = await obtenerConfiguracion(request, token);
    test.skip(
      config.minutos_limpieza_demorada !== null,
      "hay un umbral cargado en la base y no se puede borrar desde la API (exclude_none)"
    );

    await gotoDashboardAuthed(page, token);
    const bloque = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(bloque, mesa.numero)).toBeVisible();

    await expect(page.getByTestId(`mesa-${mesa.numero}-limpieza-demorada`)).toHaveCount(0);
  });

  test("15.2 la mesa se marca recién cuando pasa el umbral", async ({ page, token, request }) => {
    await actualizarConfiguracion(request, token, { minutos_limpieza_demorada: UMBRAL_MINUTOS });

    // El reloj se instala antes de navegar para que la página nazca con él puesto.
    await page.clock.install();
    await gotoDashboardAuthed(page, token);

    const bloque = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(bloque, mesa.numero)).toBeVisible();
    const badge = page.getByTestId(`mesa-${mesa.numero}-limpieza-demorada`);

    // Recién liberada: todavía no hay atraso que avisar.
    await expect(badge).toHaveCount(0);

    // Un minuto antes del umbral sigue sin marcarse. Esto es lo que distingue "el aviso
    // funciona" de "el aviso aparece siempre".
    await page.clock.fastForward(`${UMBRAL_MINUTOS - 1}:00`);
    await expect(badge).toHaveCount(0);

    // Cruzando el umbral, aparece.
    await page.clock.fastForward("02:00");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^\d+m$/);
  });

  test("15.3 confirmar la limpieza saca el aviso", async ({ page, token, request }) => {
    await actualizarConfiguracion(request, token, { minutos_limpieza_demorada: UMBRAL_MINUTOS });

    await page.clock.install();
    await gotoDashboardAuthed(page, token);
    const bloque = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(bloque, mesa.numero)).toBeVisible();

    await page.clock.fastForward(`${UMBRAL_MINUTOS + 5}:00`);
    const badge = page.getByTestId(`mesa-${mesa.numero}-limpieza-demorada`);
    await expect(badge).toBeVisible();

    // La mesa vuelve a libre: el aviso es una condición sobre pendiente_limpieza, así que
    // tiene que desaparecer aunque el reloj siga adelantado.
    await cambiarEstadoMesa(request, token, mesa.id, "libre");
    await expect(badge).toHaveCount(0);
  });
});
