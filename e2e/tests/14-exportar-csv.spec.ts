import { test, expect } from "../fixtures/test-fixtures";
import type { Download } from "@playwright/test";
import {
  createSector,
  createMesa,
  cambiarEstadoMesa,
  desactivarMesa,
  desactivarSector,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import { gotoHistorialAuthed, gotoRotacionAuthed } from "../fixtures/ui-helpers";

// Sección 14 — Exportación a CSV de historial y rotación (T26-174)
//
// Lo que se verifica es el contrato del archivo, no que "se descargue algo": el punto del
// ticket era que Excel en español lo abriera en columnas y sin romper los acentos, y eso
// depende de tres detalles que son invisibles si uno solo mira que el botón funcione —el
// BOM, el punto y coma como separador, y la fecha en dd/mm/aaaa.
//
// Locators por data-testid (T26-161).

async function leerDescarga(download: Download): Promise<string> {
  const ruta = await download.path();
  const fs = await import("node:fs/promises");
  return fs.readFile(ruta, "utf-8");
}

test.describe("con un sector y dos mesas que cambiaron de estado", () => {
  let sector: SectorResponse;
  let mesaA: MesaResponse;
  let mesaB: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    // El nombre lleva una ñ y una tilde a propósito: es lo que rompe sin BOM (ver 14.2).
    sector = await createSector(request, token, { nombre: `E2E CSV Señor Piñón ${suffix}` });
    mesaA = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    mesaB = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "libre" });
    // Genera filas de historial y rotaciones conocidas para estas mesas.
    await cambiarEstadoMesa(request, token, mesaA.id, "ocupada");
    await cambiarEstadoMesa(request, token, mesaA.id, "libre");
    await cambiarEstadoMesa(request, token, mesaB.id, "ocupada");
  });

  test.afterEach(async ({ request, token }) => {
    // Soft-delete: las mesas tienen historial y un DELETE físico daría 409.
    await desactivarMesa(request, token, mesaA.id).catch(() => {});
    await desactivarMesa(request, token, mesaB.id).catch(() => {});
    await desactivarSector(request, token, sector.id).catch(() => {});
  });

  test("14.1 el CSV de historial se descarga con las filas de la mesa exportada", async ({ page, token }) => {
    await gotoHistorialAuthed(page, token);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("historial-exportar-csv").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^historial_.*\.csv$/);

    const contenido = await leerDescarga(download);
    const [encabezado, ...filas] = contenido.split("\r\n");

    // El encabezado sale del generador, así que fija el contrato de columnas y de separador.
    expect(encabezado).toBe("\uFEFFID mesa;Mesa;Sector;Estado;Origen;Fecha");

    // El historial es global y otras corridas dejan filas suyas: se afirma solo sobre las
    // mesas que creó este test, ubicadas por su id en la primera columna.
    const propias = filas.filter((f) => f.startsWith(`${mesaA.id};`) || f.startsWith(`${mesaB.id};`));
    expect(propias.length).toBeGreaterThanOrEqual(3);
    expect(propias.some((f) => f.includes(";Ocupada;"))).toBe(true);
  });

  test("14.2 el CSV abre bien en Excel en español: BOM, punto y coma y fecha dd/mm/aaaa", async ({
    page,
    token,
  }) => {
    await gotoHistorialAuthed(page, token);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("historial-exportar-csv").click(),
    ]);
    const contenido = await leerDescarga(download);

    // Sin el BOM, Excel abre el archivo como ANSI y la ñ del sector sale corrupta.
    expect(contenido.startsWith("\uFEFF")).toBe(true);

    const propia = contenido
      .split("\r\n")
      .find((f) => f.startsWith(`${mesaA.id};`));
    expect(propia, "no se encontró ninguna fila de la mesa creada por el test").toBeTruthy();

    const columnas = propia!.split(";");
    expect(columnas).toHaveLength(6);
    expect(columnas[1]).toBe(String(mesaA.numero));
    // El acento y la ñ tienen que sobrevivir el viaje.
    expect(columnas[2]).toBe(sector.nombre);
    // Origen del cambio (T26-163): el usuario de e2e es admin, o sea una persona operando la
    // app, así que sus cambios tienen que quedar registrados como manuales. Este assert
    // recorre la cadena entera: rol -> origen_de() -> columna nueva -> API -> CSV.
    expect(columnas[4]).toBe("Manual");
    // dd/mm/aaaa hh:mm:ss — lo que un Excel en español reconoce como fecha y no como texto.
    expect(columnas[5]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  test("14.3 el CSV de rotación respeta el orden de la tabla", async ({ page, token }) => {
    await gotoRotacionAuthed(page, token);
    // La tabla arranca ordenada por rotaciones descendente. No se fija una posición absoluta:
    // el endpoint agrega sobre todas las mesas activas de la base y otras corridas dejan las
    // suyas, así que lo que se compara es el orden RELATIVO entre las dos mesas del test.
    await expect(page.getByTestId(`rotacion-fila-${mesaA.id}`)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("rotacion-exportar-csv").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^rotacion_.*\.csv$/);

    const contenido = await leerDescarga(download);
    const lineas = contenido.split("\r\n");
    expect(lineas[0]).toBe("\uFEFFMesa;Sector;Rotaciones");

    // El orden del archivo tiene que ser el mismo que el de la tabla: se comparan las
    // posiciones relativas de las dos mesas del test en la UI y en el CSV.
    const idsEnTabla = await page
      .locator("tbody tr[data-testid^='rotacion-fila-']")
      .evaluateAll((filas) =>
        filas.map((f) => (f.getAttribute("data-testid") ?? "").replace("rotacion-fila-", ""))
      );
    const posTablaA = idsEnTabla.indexOf(String(mesaA.id));
    const posTablaB = idsEnTabla.indexOf(String(mesaB.id));

    const numerosEnCsv = lineas.slice(1).filter(Boolean).map((l) => l.split(";")[0]);
    const posCsvA = numerosEnCsv.indexOf(String(mesaA.numero));
    const posCsvB = numerosEnCsv.indexOf(String(mesaB.numero));

    expect(posTablaA).toBeGreaterThanOrEqual(0);
    expect(posCsvA).toBeGreaterThanOrEqual(0);
    // Mismo signo en la comparación: si A va antes que B en la tabla, también en el CSV.
    expect(Math.sign(posCsvA - posCsvB)).toBe(Math.sign(posTablaA - posTablaB));
  });
});
