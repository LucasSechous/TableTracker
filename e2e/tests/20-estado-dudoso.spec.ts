import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  desactivarRoi,
  listarCamaras,
  crearRoi,
  obtenerConfiguracion,
  actualizarConfiguracion,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
  RoiMesaResponse,
  ConfiguracionResponse,
} from "../fixtures/api-helpers";
import { gotoDashboardAuthed, getSectorBlock, getMesaCircle } from "../fixtures/ui-helpers";

// Sección 20 — Aviso de estado dudoso (T26-188, RF-27)
//
// El criterio depende de la hora del reloj, y a diferencia de la sección 15 no se puede
// resolver con page.clock: acá el que decide es el BACKEND —es el único que sabe la hora de
// cierre y qué mesas tienen ROI— y el reloj simulado de Playwright solo afecta al navegador.
//
// Lo que sí se puede mover es el horario de servicio. En vez de esperar a que sean las 3 de
// la mañana, se corre la ventana de apertura/cierre para que la hora actual quede adentro o
// afuera según lo que el caso necesite. Es el mismo dato que un admin edita en Configuración.
//
// Locators por data-testid (T26-161).

const HUSO = "America/Montevideo"; // el default de TZ_LOCAL en backend/app/services/horario.py

/** Hora del reloj del local, que es contra la que el backend evalúa la franja. */
function horaLocalActual(): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: HUSO,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return Number(partes.find((p) => p.type === "hour")!.value) % 24;
}

const hh = (hora: number) => `${String(((hora % 24) + 24) % 24).padStart(2, "0")}:00`;

/** Ventana que deja la hora actual AFUERA: abre dentro de 2h y cierra dentro de 3h. */
function ventanaCerrada() {
  const h = horaLocalActual();
  return { hora_apertura: hh(h + 2), hora_cierre: hh(h + 3) };
}

/** Ventana que deja la hora actual ADENTRO: abrió hace 1h y cierra dentro de 1h. */
function ventanaAbierta() {
  const h = horaLocalActual();
  return { hora_apertura: hh(h - 1), hora_cierre: hh(h + 1) };
}

test.describe("con una mesa ocupada bajo una cámara activa", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;
  let sinCobertura: MesaResponse;
  let roi: RoiMesaResponse | null = null;
  let configPrevia: ConfiguracionResponse;

  test.beforeEach(async ({ request, token }) => {
    configPrevia = await obtenerConfiguracion(request, token);

    const camaras = await listarCamaras(request, token);
    const activa = camaras.find((c) => c.activa);
    test.skip(!activa, "no hay ninguna cámara activa en la base: sin ella no hay cobertura que probar");

    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Dudoso ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    // La mesa de control: misma situación pero SIN ROI, para que el contraste dentro del
    // mismo salón muestre que lo que enciende el aviso es la cobertura y no la hora.
    sinCobertura = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "libre" });

    roi = await crearRoi(request, token, { mesa_id: mesa.id, camara_id: activa!.id });
    // Vía el endpoint de estado, que es el que además mueve estado_desde.
    await cambiarEstadoMesa(request, token, mesa.id, "ocupada");
    await cambiarEstadoMesa(request, token, sinCobertura.id, "ocupada");
  });

  test.afterEach(async ({ request, token }) => {
    // El horario es configuración global: dejarlo corrido haría que el resto de la suite
    // corriera con un local que abre a una hora inventada, y eso además recorta las
    // métricas de rotación (T26-171).
    await actualizarConfiguracion(request, token, {
      hora_apertura: configPrevia.hora_apertura ?? undefined,
      hora_cierre: configPrevia.hora_cierre ?? undefined,
    }).catch(() => {});
    if (roi) await desactivarRoi(request, token, roi.id).catch(() => {});
    await desactivarMesa(request, token, mesa.id).catch(() => {});
    await desactivarMesa(request, token, sinCobertura.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
    roi = null;
  });

  test("20.1 fuera del horario, la mesa ocupada con ROI se marca como dudosa", async ({
    page,
    token,
    request,
  }) => {
    await actualizarConfiguracion(request, token, ventanaCerrada());

    await gotoDashboardAuthed(page, token);
    const bloque = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(bloque, mesa.numero)).toBeVisible();

    await expect(page.getByTestId(`mesa-${mesa.numero}-estado-dudoso`)).toBeVisible();
  });

  test("20.2 dentro del horario, la misma mesa no se marca", async ({ page, token, request }) => {
    await actualizarConfiguracion(request, token, ventanaAbierta());

    await gotoDashboardAuthed(page, token);
    const bloque = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(bloque, mesa.numero)).toBeVisible();

    await expect(page.getByTestId(`mesa-${mesa.numero}-estado-dudoso`)).toHaveCount(0);
  });

  test("20.3 una mesa ocupada sin ROI no se marca ni con el local cerrado", async ({
    page,
    token,
    request,
  }) => {
    // El caso que evita que la alerta marque medio salón: sin cobertura de cámara la mesa
    // no puede actualizarse sola, así que es un hueco de setup y no una falla de detección.
    await actualizarConfiguracion(request, token, ventanaCerrada());

    await gotoDashboardAuthed(page, token);
    const bloque = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(bloque, sinCobertura.numero)).toBeVisible();

    // La de al lado sí se marca: mismo salón, misma hora, misma mesa ocupada. La única
    // diferencia es el ROI.
    await expect(page.getByTestId(`mesa-${mesa.numero}-estado-dudoso`)).toBeVisible();
    await expect(page.getByTestId(`mesa-${sinCobertura.numero}-estado-dudoso`)).toHaveCount(0);
  });

  test("20.4 al liberar la mesa el aviso desaparece", async ({ page, token, request }) => {
    await actualizarConfiguracion(request, token, ventanaCerrada());

    await gotoDashboardAuthed(page, token);
    const aviso = page.getByTestId(`mesa-${mesa.numero}-estado-dudoso`);
    await expect(aviso).toBeVisible();

    // Es la corrección que haría el encargado al ver el aviso: la mesa no estaba ocupada.
    await cambiarEstadoMesa(request, token, mesa.id, "libre");

    // El dashboard repregunta /mesas cada 3s (INTERVALO_REFRESCO_MESAS_MS).
    await expect(aviso).toHaveCount(0, { timeout: 15_000 });
  });

  test("20.5 el aviso no se muestra en modo edición", async ({ page, token, request }) => {
    // Mismo criterio que el aviso de limpieza demorada (T26-173): en edición el canvas es
    // para acomodar mesas y los badges compiten con los controles de arrastre.
    await actualizarConfiguracion(request, token, ventanaCerrada());

    await gotoDashboardAuthed(page, token);
    const aviso = page.getByTestId(`mesa-${mesa.numero}-estado-dudoso`);
    await expect(aviso).toBeVisible();

    await page.getByText("Editar disposición").click();
    await expect(aviso).toHaveCount(0, { timeout: 15_000 });
  });
});
