import { test, expect } from "../fixtures/test-fixtures";
import type { APIRequestContext, Page } from "@playwright/test";
import {
  createSector,
  createMesa,
  desactivarMesa,
  desactivarSector,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import { gotoDashboardAuthed, getSectorBlock, getMesaCircle, injectToken } from "../fixtures/ui-helpers";
import { BACKEND_URL } from "../playwright.config";

// Sección 28 — La cámara que enfoca una mesa, en su panel (T26-206)
//
// El vínculo mesa -> cámara no es un campo de la mesa: existe porque alguien dibujó un ROI
// sobre el frame de una cámara para esa mesa. Por eso el panel lo resuelve con
// GET /roi-mesa/?mesa_id=..., que ya trae camara_id y camara_nombre.
//
// Lo que más importa verificar acá es el caso NEGATIVO. La sección de cámara solo se
// dibuja para admin, y eso no es una comodidad: docs/privacidad-vision.md declara la
// restricción de las cámaras a admin como control de privacidad, referenciado contra las
// secciones 9.2, 13.6 y 14.4 del anteproyecto. Un test que solo mirara el caso feliz
// dejaría pasar una regresión que contradice lo que la tesis da por cumplido.

async function abrirPanelDeMesa(page: Page, sectorNombre: string, numero: number) {
  await getMesaCircle(getSectorBlock(page, sectorNombre), numero).click();
  await expect(page.getByTestId("panel-mesa-toggle-correccion")).toBeVisible();
}

/** Una mesa que SÍ tiene ROI activo, o null si la base no tiene ninguna. */
async function mesaConCamara(request: APIRequestContext, token: string) {
  const res = await request.get(`${BACKEND_URL}/roi-mesa/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rois = (await res.json()) as Array<{ mesa_id: number; activa: boolean; camara_nombre: string | null }>;
  return rois.find((r) => r.activa) ?? null;
}

test.describe("con una mesa sin cámara asignada", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Camara ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
  });

  test.afterEach(async ({ request, token }) => {
    await desactivarMesa(request, token, mesa.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("28.1 el panel dice que ninguna cámara la enfoca, y dónde se resuelve", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    await abrirPanelDeMesa(page, sector.nombre, mesa.numero);

    // Que una mesa no tenga cámara es normal, no un fallo: se calibra ROI solo donde hace
    // falta. Lo que no puede pasar es que la sección quede en blanco sin explicar nada.
    const aviso = page.getByTestId("panel-mesa-sin-camara");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("Calibración de ROI");

    // Y sin cámara no se ofrece verla.
    await expect(page.getByTestId("panel-mesa-ver-camara")).toHaveCount(0);
  });

  test("28.2 un rol no admin no ve la sección de cámara", async ({ page, tokenDeRol }) => {
    // El control de privacidad: para cualquier rol que no sea admin la sección no existe.
    // No se muestra un "no tenés permiso" — el panel de la mesa es la herramienta diaria
    // de ese rol y no corresponde llenarlo con avisos de algo que no va a poder hacer.
    const tokenMozo = await tokenDeRol("mozo");
    await injectToken(page, tokenMozo);
    await page.goto("/");
    await page.getByText("Cargando salón...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    await abrirPanelDeMesa(page, sector.nombre, mesa.numero);

    await expect(page.getByTestId("panel-mesa-camara")).toHaveCount(0);
  });
});

test("28.3 una mesa con ROI nombra su cámara y ofrece verla en vivo", async ({ page, token, request }) => {
  const roi = await mesaConCamara(request, token);
  test.skip(roi === null, "la base no tiene ningún ROI activo con el cual probar el caso positivo");

  await gotoDashboardAuthed(page, token);

  // Se abre el panel por la API y no clickeando el canvas: esta mesa es de la instalación
  // real, no sembrada por el test, así que no se sabe en qué sector ni en qué posición
  // está. Lo que se verifica es el contenido del panel, no cómo se llega a él.
  const mesaRes = await request.get(`${BACKEND_URL}/mesas/${roi!.mesa_id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mesa = await mesaRes.json();

  const bloque = page.getByTestId(`sector-bloque-${mesa.sector.nombre}`);
  await getMesaCircle(bloque, mesa.numero).click();
  await expect(page.getByTestId("panel-mesa-toggle-correccion")).toBeVisible();

  await expect(page.getByTestId("panel-mesa-camara-nombre")).toBeVisible();
  // El botón y no el video: la cámara ya tiene una conexión RTSP abierta —la del módulo de
  // visión— y abrir otra cada vez que alguien toca una mesa competiría con la detección,
  // que es la función principal del sistema.
  await expect(page.getByTestId("panel-mesa-ver-camara")).toBeVisible();
  await expect(page.getByTestId("panel-mesa-sin-camara")).toHaveCount(0);
});
