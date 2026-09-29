import { test, expect } from "../fixtures/test-fixtures";
import type { APIRequestContext } from "@playwright/test";
import {
  createSector,
  createMesa,
  desactivarMesa,
  desactivarSector,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import { gotoDashboardAuthed, getSectorBlock, getMesaCircle } from "../fixtures/ui-helpers";
import { BACKEND_URL } from "../playwright.config";

// Sección 27 — Reserva con hora y confirmación de ocupación (T26-208)
//
// Antes de este ticket el sistema sabía QUE una mesa estaba reservada pero no para cuándo,
// y el módulo de visión mandaba `reservada + hay gente -> ocupada` dando por hecho que era
// quien había reservado. Ese supuesto falla cuando alguien se sienta sin ver que la mesa
// está tomada: marcarla ocupada borra la reserva justo antes de que lleguen los que sí
// reservaron.
//
// Lo que se cubre acá son las dos mitades: que la hora se vea en el salón, y que una
// detección lejos de esa hora deje la decisión en manos de una persona en vez de pisar la
// reserva.
//
// Las llamadas van directo contra la API y no por api-helpers porque son endpoints nuevos
// que todavía no tienen envoltorio; los helpers se agregarán si otro spec los necesita.

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function reservarPara(
  request: APIRequestContext,
  token: string,
  mesaId: number,
  cuando: Date | null
) {
  const res = await request.patch(`${BACKEND_URL}/mesas/${mesaId}/reserva`, {
    headers: auth(token),
    data: cuando ? { reservada_para: cuando.toISOString() } : {},
  });
  if (!res.ok()) throw new Error(`No se pudo reservar: ${res.status()} ${await res.text()}`);
  return res.json();
}

/** Simula lo que hace el módulo de visión al ver gente lejos de la hora reservada. */
async function detectarGenteEnReserva(request: APIRequestContext, token: string, mesaId: number) {
  const res = await request.patch(`${BACKEND_URL}/mesas/${mesaId}/deteccion-reserva`, {
    headers: auth(token),
  });
  if (!res.ok()) throw new Error(`No se pudo marcar la detección: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function leerMesa(request: APIRequestContext, token: string, mesaId: number) {
  const res = await request.get(`${BACKEND_URL}/mesas/${mesaId}`, { headers: auth(token) });
  return res.json();
}

function etiqueta(page: import("@playwright/test").Page, numero: number) {
  return page.getByTestId(`mesa-${numero}-tiempo-en-estado`);
}

test.describe("con una mesa reservada", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Reserva ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
  });

  test.afterEach(async ({ request, token }) => {
    await desactivarMesa(request, token, mesa.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("27.1 la mesa muestra PARA CUÁNDO es la reserva, no hace cuánto se reservó", async ({
    page,
    token,
    request,
  }) => {
    // Dentro de un rato: la hora todavía no pasó, así que no hay atraso que mostrar.
    const enUnRato = new Date(Date.now() + 90 * 60_000);
    await reservarPara(request, token, mesa.id, enUnRato);

    await gotoDashboardAuthed(page, token);
    await expect(getMesaCircle(getSectorBlock(page, sector.nombre), mesa.numero)).toBeVisible();

    // La hora se arma en el navegador desde el instante absoluto, así que lo que se ve es
    // la hora del reloj local. Eso es justamente lo que se verifica: si el ISO se cortara
    // como texto, acá saldría la hora UTC, tres horas corrida.
    // hour12 en false, igual que horaDeLaReserva(): el default de es-UY es 12 horas y
    // devolvería "04:53 p. m.", que no entra en una etiqueta de 60px. Si esta expectativa
    // no replicara las MISMAS opciones que la aplicación, el test verificaría el formato
    // de Intl en vez de lo que le interesa, que es que la hora mostrada sea la local.
    const esperada = enUnRato.toLocaleTimeString("es-UY", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    await expect(etiqueta(page, mesa.numero)).toHaveText(esperada);
  });

  test("27.2 sin hora, la reserva sigue mostrando el tiempo transcurrido", async ({
    page,
    token,
    request,
  }) => {
    // Reservar sin hora seguía siendo válido antes de T26-208 y tiene que seguir siéndolo:
    // las reservas ya cargadas no tienen hora y la pantalla no puede romperse con ellas.
    await reservarPara(request, token, mesa.id, null);

    await gotoDashboardAuthed(page, token);
    await expect(etiqueta(page, mesa.numero)).toHaveText(/^\d+m$/);
  });

  test("27.3 pasada la hora, la etiqueta pasa a contar el atraso", async ({ page, token, request }) => {
    const hace20Minutos = new Date(Date.now() - 20 * 60_000);
    await reservarPara(request, token, mesa.id, hace20Minutos);

    await gotoDashboardAuthed(page, token);
    // El "+" es lo que distingue el atraso de la hora: "+20m" contra "21:00".
    await expect(etiqueta(page, mesa.numero)).toHaveText(/^\+\d+m$/);
  });

  test("27.4 una detección lejos de la hora NO ocupa la mesa: pide confirmación", async ({
    page,
    token,
    request,
  }) => {
    await reservarPara(request, token, mesa.id, new Date(Date.now() + 3 * 3600_000));
    await detectarGenteEnReserva(request, token, mesa.id);

    await gotoDashboardAuthed(page, token);

    // Lo esencial del ticket: la mesa NO se ocupó sola.
    const despues = await leerMesa(request, token, mesa.id);
    expect(despues.estado).toBe("reservada");

    await expect(page.getByTestId("aviso-reserva-detectada")).toBeVisible();
    await expect(page.getByTestId(`aviso-reserva-mesa-${mesa.numero}`)).toBeVisible();
  });

  test("27.5 «Sí, ocupar» ocupa la mesa y limpia el aviso", async ({ page, token, request }) => {
    await reservarPara(request, token, mesa.id, new Date(Date.now() + 3 * 3600_000));
    await detectarGenteEnReserva(request, token, mesa.id);

    await gotoDashboardAuthed(page, token);
    await page.getByTestId(`aviso-reserva-confirmar-${mesa.numero}`).click();

    await expect(page.getByTestId(`aviso-reserva-mesa-${mesa.numero}`)).toHaveCount(0);

    const despues = await leerMesa(request, token, mesa.id);
    expect(despues.estado).toBe("ocupada");
    // Los datos de la reserva se limpian solos al cambiar de estado: si quedaran, una mesa
    // ocupada arrastraría la hora de una reserva ya consumida.
    expect(despues.reservada_para).toBeNull();
    expect(despues.ocupacion_detectada_en).toBeNull();
  });

  test("27.6 «No son ellos» descarta el aviso y deja la reserva en pie", async ({
    page,
    token,
    request,
  }) => {
    await reservarPara(request, token, mesa.id, new Date(Date.now() + 3 * 3600_000));
    await detectarGenteEnReserva(request, token, mesa.id);

    await gotoDashboardAuthed(page, token);
    await page.getByTestId(`aviso-reserva-descartar-${mesa.numero}`).click();

    await expect(page.getByTestId(`aviso-reserva-mesa-${mesa.numero}`)).toHaveCount(0);

    const despues = await leerMesa(request, token, mesa.id);
    // La mesa sigue esperando a quien reservó, con su hora intacta.
    expect(despues.estado).toBe("reservada");
    expect(despues.reservada_para).not.toBeNull();
    expect(despues.ocupacion_detectada_en).toBeNull();
  });
});
