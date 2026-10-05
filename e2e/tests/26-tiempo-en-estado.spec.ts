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
import { gotoDashboardAuthed, getSectorBlock, getMesaCircle, entrarEnModoEdicion } from "../fixtures/ui-helpers";

// Sección 26 — Tiempo en el estado actual sobre la mesa (T26-208)
//
// La etiqueta reemplaza al badge rojo que antes avisaba la limpieza demorada por su
// cuenta. Los dos decían el mismo número —los minutos en el estado— así que conviviendo lo
// habrían mostrado dos veces en la misma mesa. Ahora hay una sola, y el atraso es un color
// suyo. La sección 15 sigue cubriendo el umbral y no se duplica acá.
//
// Lo que sí se verifica acá es la regla de CUÁNDO aparece, que es lo propio de este
// ticket: en los estados que alguien tiene que resolver, y en ninguno más.

const UMBRAL_MINUTOS = 15;

function etiquetaTiempo(page: import("@playwright/test").Page, numero: number) {
  return page.getByTestId(`mesa-${numero}-tiempo-en-estado`);
}

test.describe("con una mesa que va cambiando de estado", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;
  let configPrevia: ConfiguracionResponse;

  test.beforeEach(async ({ request, token }) => {
    configPrevia = await obtenerConfiguracion(request, token);
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Tiempo ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
  });

  test.afterEach(async ({ request, token }) => {
    // El umbral es configuración global: dejarlo puesto marcaría como atrasadas a las
    // mesas de otros specs. Mismo cuidado que toma la sección 15.
    await actualizarConfiguracion(request, token, {
      minutos_limpieza_demorada: configPrevia.minutos_limpieza_demorada ?? undefined,
    }).catch(() => {});
    await desactivarMesa(request, token, mesa.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("26.1 una mesa libre no muestra el tiempo", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    await expect(getMesaCircle(getSectorBlock(page, sector.nombre), mesa.numero)).toBeVisible();

    // Que una mesa lleve cuarenta minutos libre no cambia la conducta de nadie, y en un
    // salón tranquilo la mayoría está libre: mostrarlo ahí taparía justo las que importan.
    await expect(etiquetaTiempo(page, mesa.numero)).toHaveCount(0);
  });

  test("26.2 una mesa ocupada muestra hace cuánto lo está", async ({ page, token, request }) => {
    await cambiarEstadoMesa(request, token, mesa.id, "ocupada");
    await gotoDashboardAuthed(page, token);

    const etiqueta = etiquetaTiempo(page, mesa.numero);
    await expect(etiqueta).toBeVisible();
    // Recién ocupada: minutos, no horas.
    await expect(etiqueta).toHaveText(/^\d+m$/);
  });

  test("26.3 una mesa reservada también, que es cuánto hace que se retiene", async ({ page, token, request }) => {
    await cambiarEstadoMesa(request, token, mesa.id, "reservada");
    await gotoDashboardAuthed(page, token);

    await expect(etiquetaTiempo(page, mesa.numero)).toBeVisible();
  });

  test("26.4 pendiente de limpieza la muestra, y al pasar el umbral pasa a ser el aviso", async ({
    page,
    token,
    request,
  }) => {
    await actualizarConfiguracion(request, token, { minutos_limpieza_demorada: UMBRAL_MINUTOS });
    await cambiarEstadoMesa(request, token, mesa.id, "pendiente_limpieza");

    await page.clock.install();
    await gotoDashboardAuthed(page, token);
    await expect(getMesaCircle(getSectorBlock(page, sector.nombre), mesa.numero)).toBeVisible();

    // Antes del umbral hay tiempo pero no hay atraso: una sola etiqueta, la neutra.
    await expect(etiquetaTiempo(page, mesa.numero)).toBeVisible();
    await expect(page.getByTestId(`mesa-${mesa.numero}-limpieza-demorada`)).toHaveCount(0);

    await page.clock.fastForward(`${UMBRAL_MINUTOS + 1}:00`);

    // Cruzado el umbral, la MISMA etiqueta pasa a ser el aviso. Lo que se comprueba es que
    // no aparece una segunda: el número de minutos tiene que salir una sola vez por mesa.
    await expect(page.getByTestId(`mesa-${mesa.numero}-limpieza-demorada`)).toBeVisible();
    await expect(etiquetaTiempo(page, mesa.numero)).toHaveCount(0);
  });

  test("26.5 en modo edición no se dibuja: el canvas ahí es para acomodar mesas", async ({
    page,
    token,
    request,
  }) => {
    await cambiarEstadoMesa(request, token, mesa.id, "ocupada");
    await gotoDashboardAuthed(page, token);
    await expect(etiquetaTiempo(page, mesa.numero)).toBeVisible();

    await entrarEnModoEdicion(page);
    await expect(etiquetaTiempo(page, mesa.numero)).toHaveCount(0);
  });
});
