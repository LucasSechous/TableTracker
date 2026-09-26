import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  obtenerConfiguracion,
  actualizarConfiguracion,
  obtenerOcupacion,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
  ConfiguracionResponse,
} from "../fixtures/api-helpers";
import { gotoDashboardAuthed } from "../fixtures/ui-helpers";

// Sección 19 — Aviso de salón al límite (T26-187, RF-26)
//
// Diferencia importante con la alerta de limpieza demorada (sección 15): aquella es una
// condición sobre UNA mesa, así que el test la controla sembrando esa mesa. Esta es una
// condición sobre el TOTAL del salón, y el salón incluye todas las mesas activas de la base
// —las que sembró este test y las que ya estaban—. Sembrar cuatro mesas no fija el
// porcentaje en 25%: lo mueve un poco respecto de lo que hubiera dado igual.
//
// Por eso el umbral se deriva del porcentaje MEDIDO en el momento, en vez de hardcodear
// valores que dependerían del estado de la base. Es lo que hace que el spec valga tanto en
// una base recién migrada como en la de desarrollo con mesas de corridas anteriores.
//
// Locators por data-testid (T26-161).

const AVISO = "dashboard-ocupacion-alta";

/** Umbral que la ocupación actual SÍ alcanza. La mitad del % medido, que con % > 0 siempre
 *  es menor que él y sigue siendo > 0, que es lo que exige la validación del backend. */
function umbralQueAlerta(porcentaje: number): number {
  return Math.max(0.01, Number((porcentaje / 2).toFixed(2)));
}

/** Umbral que la ocupación actual NO alcanza: el punto medio entre el % medido y 100. Con
 *  % < 100 garantizado (el fixture deja una mesa libre) siempre queda por encima. */
function umbralQueNoAlerta(porcentaje: number): number {
  return Math.min(100, Number((porcentaje + (100 - porcentaje) / 2).toFixed(2)));
}

test.describe("con una mesa ocupada y otra libre", () => {
  let sector: SectorResponse;
  let ocupada: MesaResponse;
  let libre: MesaResponse;
  let configPrevia: ConfiguracionResponse;

  test.beforeEach(async ({ request, token }) => {
    configPrevia = await obtenerConfiguracion(request, token);
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Ocupacion ${suffix}` });
    // Las dos mesas existen para acotar el porcentaje global por los dos lados: la ocupada
    // garantiza que sea > 0 (si fuera 0 no habría ningún umbral válido que lo alcance,
    // porque el mínimo es mayor que 0) y la libre que sea < 100 (si fuera 100 no habría
    // ninguno que no lo alcance, porque el máximo es 100).
    ocupada = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    libre = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "libre" });
    await cambiarEstadoMesa(request, token, ocupada.id, "ocupada");
  });

  test.afterEach(async ({ request, token }) => {
    // El umbral es configuración global: dejarlo tocado haría que el resto de la suite
    // corriera con un salón que alerta (o que no alerta nunca) sin que su spec lo pida.
    await actualizarConfiguracion(request, token, {
      umbral_ocupacion_alta: configPrevia.umbral_ocupacion_alta,
    }).catch(() => {});
    await desactivarMesa(request, token, ocupada.id).catch(() => {});
    await desactivarMesa(request, token, libre.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("19.1 por debajo del umbral no se muestra el aviso", async ({ page, token, request }) => {
    const { porcentaje_ocupacion } = await obtenerOcupacion(request, token);
    await actualizarConfiguracion(request, token, {
      umbral_ocupacion_alta: umbralQueNoAlerta(porcentaje_ocupacion),
    });

    await gotoDashboardAuthed(page, token);

    await expect(page.getByTestId(AVISO)).toHaveCount(0);
  });

  test("19.2 al superar el umbral aparece el aviso", async ({ page, token, request }) => {
    const { porcentaje_ocupacion } = await obtenerOcupacion(request, token);
    const umbral = umbralQueAlerta(porcentaje_ocupacion);
    await actualizarConfiguracion(request, token, { umbral_ocupacion_alta: umbral });

    await gotoDashboardAuthed(page, token);

    const aviso = page.getByTestId(AVISO);
    await expect(aviso).toBeVisible();
    // El aviso dice los dos números, no solo "salón lleno": sin el umbral al lado del
    // porcentaje no se puede saber si el aviso está bien calibrado o quedó de una prueba.
    await expect(aviso).toContainText(`${porcentaje_ocupacion}%`);
    await expect(aviso).toContainText(`${umbral}%`);
  });

  test("19.3 al bajar la ocupación el aviso desaparece solo", async ({ page, token, request }) => {
    // El umbral se fija EN el porcentaje actual: así el aviso arranca encendido y liberar
    // una mesa lo deja estrictamente por debajo, sin depender de cuántas mesas ajenas al
    // test haya en la base.
    const { porcentaje_ocupacion } = await obtenerOcupacion(request, token);
    await actualizarConfiguracion(request, token, { umbral_ocupacion_alta: porcentaje_ocupacion });

    await gotoDashboardAuthed(page, token);
    const aviso = page.getByTestId(AVISO);
    await expect(aviso).toBeVisible();

    // Se libera la mesa ocupada por API, como haría vision-module: el aviso tiene que
    // apagarse solo en el próximo ciclo de refresco, sin recargar la página. Una alerta que
    // se enciende y hay que recargar para que se apague es peor que no tenerla.
    await cambiarEstadoMesa(request, token, ocupada.id, "libre");

    // Timeout holgado: el dashboard repregunta la ocupación cada 3s (INTERVALO_REFRESCO_
    // MESAS_MS), más de lo que espera el expect por defecto.
    await expect(aviso).toHaveCount(0, { timeout: 15_000 });
  });

  test("19.4 el aviso no se muestra en modo edición", async ({ page, token, request }) => {
    // Mismo criterio que la alerta de limpieza demorada (T26-173): en edición el canvas es
    // para acomodar mesas y los avisos compiten con los controles de arrastre.
    const { porcentaje_ocupacion } = await obtenerOcupacion(request, token);
    await actualizarConfiguracion(request, token, {
      umbral_ocupacion_alta: umbralQueAlerta(porcentaje_ocupacion),
    });

    await gotoDashboardAuthed(page, token);
    const aviso = page.getByTestId(AVISO);
    await expect(aviso).toBeVisible();

    await page.getByText("Editar disposición").click();
    await expect(aviso).toHaveCount(0, { timeout: 15_000 });
  });
});
