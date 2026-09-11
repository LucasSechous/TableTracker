import { test, expect } from "../fixtures/test-fixtures";
import type { Download } from "@playwright/test";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  obtenerOcupacionDiaria,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  gotoOcupacionDiariaAuthed,
  waitForOcupacionDiariaLoaded,
  getOcupacionDiariaFechaInput,
  getOcupacionDiariaSectorSelect,
  getOcupacionDiariaBuscarButton,
  getOcupacionDiariaPorcentaje,
  getOcupacionDiariaFila,
  getOcupacionDiariaPorcentajeFila,
  getOcupacionDiariaFilas,
} from "../fixtures/ui-helpers";

// Sección 22 — Reporte de ocupación diaria (T26-185, RF-32)
//
// El backend reconstruye minutos por estado desde historial_estados y el algoritmo en sí
// (corte de día, arrastre de estado, mesas inactivas, etc.) ya está cubierto por
// backend/tests/test_metricas.py con fechas fijas. Lo que se prueba acá es el circuito
// completo con datos de HOY (no se puede fijar "ayer" contra un backend real en marcha):
// que la pantalla refleje lo que devuelve GET /metricas/ocupacion-diaria, que el filtro de
// sector funcione, y que el CSV tenga el contrato esperado.

async function leerDescarga(download: Download): Promise<string> {
  const ruta = await download.path();
  const fs = await import("node:fs/promises");
  return fs.readFile(ruta, "utf-8");
}

test("16.1 acceder a /ocupacion-diaria sin sesión redirige a /login", async ({ page }) => {
  await page.goto("/ocupacion-diaria");
  await expect(page).toHaveURL(/\/login$/);
});

test("16.2 la entrada del menú lateral navega al reporte de ocupación diaria", async ({ page, token }) => {
  await gotoDashboardAuthed(page, token);
  await page.getByRole("button", { name: "Abrir menú" }).click();

  const entrada = page.getByRole("button", { name: "Ocupación diaria" });
  await expect(entrada).toBeVisible();
  await entrada.click();

  await expect(page).toHaveURL(/\/ocupacion-diaria$/);
  await expect(page.getByRole("heading", { name: "Ocupación diaria" })).toBeVisible();
});

test.describe("con un sector y una mesa que se ocupó hoy", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Ocupación diaria ${suffix}` });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    await cambiarEstadoMesa(request, token, mesa.id, "ocupada");
  });

  test.afterEach(async ({ request, token }) => {
    // Soft-delete: la mesa tiene historial y un DELETE físico daría 409.
    await desactivarMesa(request, token, mesa.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("16.3 la vista de hoy refleja lo que devuelve GET /metricas/ocupacion-diaria", async ({
    page,
    token,
    request,
  }) => {
    await gotoOcupacionDiariaAuthed(page, token);

    // Sin tocar el filtro, la pantalla ya carga "hoy" por default (mismo criterio que el
    // backend cuando no se manda `fecha`). No se compara el input contra una fecha armada
    // en el test: el huso del navegador que corre Playwright no tiene por qué coincidir
    // con TZ_LOCAL, así que lo que importa es que los DATOS coincidan con la API, no el
    // string del input.
    await expect(getOcupacionDiariaFechaInput(page)).not.toHaveValue("");
    await expect(getOcupacionDiariaFila(page, mesa.id)).toBeVisible();

    // El reporte de API se pide DESPUÉS de que la pantalla ya cargó el suyo (para minimizar
    // la diferencia), y se compara con tolerancia en vez de texto exacto: "hoy" es una
    // ventana que sigue corriendo (fin = min(fin_teórico, ahora)), así que dos pedidos
    // separados por un instante pueden diferir en el margen de redondeo del %, sobre todo
    // para una mesa que se acaba de ocupar y todavía acumuló muy pocos minutos.
    const reporte = await obtenerOcupacionDiaria(request, token);
    const filaApi = reporte.mesas.find((f) => f.mesa_id === mesa.id);
    expect(filaApi, "la mesa recién ocupada tiene que aparecer en el reporte de hoy").toBeTruthy();

    const porcentajeGeneral = Number((await getOcupacionDiariaPorcentaje(page).innerText()).replace("%", ""));
    expect(porcentajeGeneral).toBeCloseTo(reporte.porcentaje_ocupacion, 1);

    const porcentajeFila = Number(
      (await getOcupacionDiariaPorcentajeFila(page, mesa.id).innerText()).replace("%", "")
    );
    expect(porcentajeFila).toBeCloseTo(filaApi!.porcentaje_ocupacion, 1);
  });

  test("16.4 el filtro de sector acota la tabla a las mesas de ese sector", async ({ page, token }) => {
    await gotoOcupacionDiariaAuthed(page, token);
    await expect(getOcupacionDiariaFila(page, mesa.id)).toBeVisible();

    await getOcupacionDiariaSectorSelect(page).selectOption(String(sector.id));
    await getOcupacionDiariaBuscarButton(page).click();
    await waitForOcupacionDiariaLoaded(page);

    // El sector es exclusivo de este test (nombre único), así que filtrar por él deja
    // exactamente la mesa creada acá.
    await expect(getOcupacionDiariaFilas(page)).toHaveCount(1);
    await expect(getOcupacionDiariaFila(page, mesa.id)).toBeVisible();
  });

  test("16.5 el CSV de ocupación diaria se descarga con el contrato esperado", async ({ page, token }) => {
    await gotoOcupacionDiariaAuthed(page, token);
    await expect(getOcupacionDiariaFila(page, mesa.id)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("ocupacion-diaria-exportar-csv").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^ocupacion-diaria_.*\.csv$/);

    const contenido = await leerDescarga(download);
    const lineas = contenido.split("\r\n");

    // El encabezado fija el contrato de columnas, el BOM y el punto y coma como separador
    // (mismas reglas de T26-174 que ya usan historial y rotación).
    expect(lineas[0]).toBe(
      "﻿Mesa;Sector;% Ocupación;Libre (min);Ocupada (min);Pendiente limpieza (min);Reservada (min)"
    );

    // Se ubica la fila por el NOMBRE del sector (único por test gracias a uniqueSuffix), no
    // por el número de mesa: "Mesa" en este CSV es fila.numero, que solo es único DENTRO de
    // un sector (UniqueConstraint("numero", "sector_id")) — buscar por numero=1 a secas
    // puede matchear la mesa de cualquier otro sector que también tenga una mesa 1.
    const propia = lineas.find((l) => l.includes(`;${sector.nombre};`));
    expect(propia, "no se encontró la fila de la mesa creada por el test").toBeTruthy();
    const columnas = propia!.split(";");
    expect(columnas[0]).toBe(String(mesa.numero));
  });
});
