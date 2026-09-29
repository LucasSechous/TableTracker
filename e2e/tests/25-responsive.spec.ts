import { test, expect } from "../fixtures/test-fixtures";
import { gotoDashboardAuthed, injectToken } from "../fixtures/ui-helpers";

// Sección 25 — Comportamiento responsive (T26-209)
//
// Este spec cubre las dos mitades del cambio, y la primera importa tanto como la segunda.
//
// La mitad de ESCRITORIO es una prueba de no-regresión. El padding de las diez pantallas
// dejó de estar inline y pasó a una clase CSS, que es la única forma de que dependa del
// ancho: un objeto style de React no admite media queries. Ese movimiento tiene un modo de
// falla silencioso —si la clase no se aplica o la hoja no carga, el padding no queda mal,
// queda en cero— así que se afirma el número exacto que había antes.
//
// La mitad de CELULAR verifica lo que el cambio vino a arreglar: que la página no scrollee
// de costado. Es la falla que más molesta en un teléfono, porque el encabezado es fixed y
// al arrastrar la página se despega de su lugar.

const ESCRITORIO = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };

/** Cuánto se puede scrollear de costado el documento. 0 = no hay desborde. */
async function desbordeHorizontal(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
}

async function paddingIzquierdoDelMain(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    return main ? getComputedStyle(main).paddingLeft : "sin main";
  });
}

test("25.1 en escritorio el padding del contenido sigue siendo el de siempre", async ({ page, token }) => {
  await page.setViewportSize(ESCRITORIO);
  await gotoDashboardAuthed(page, token);

  // 24px es el valor que las diez pantallas tenían escrito inline antes de T26-209.
  expect(await paddingIzquierdoDelMain(page)).toBe("24px");
});

test("25.2 en celular el contenido respira menos, pero respira", async ({ page, token }) => {
  await page.setViewportSize(CELULAR);
  await gotoDashboardAuthed(page, token);

  expect(await paddingIzquierdoDelMain(page)).toBe("16px");
});

test("25.3 el salón no hace scrollear la página de costado en un celular", async ({ page, token }) => {
  await page.setViewportSize(CELULAR);
  await gotoDashboardAuthed(page, token);

  // El salón mide lo que diga la configuración (típicamente 1200px de ancho) y no cambia
  // de tamaño según la pantalla: es un plano a escala, y encogerlo dejaría las mesas
  // demasiado chicas para tocarlas. Lo que sí tiene que pasar es que ese ancho se resuelva
  // DENTRO del canvas y no empujando el documento entero.
  expect(await desbordeHorizontal(page)).toBe(0);
});

// Un caso por ruta y no un bucle dentro de uno solo: recorrer las ocho en un test se pasaba
// del timeout por el tiempo de carga sumado, y además, cuando fallaba, el reporte culpaba a
// la última ruta visitada en vez de a la que desbordaba.
const RUTAS = [
  "/historial",
  "/ocupacion",
  "/rotacion",
  "/ocupacion-diaria",
  "/demanda",
  "/camaras",
  "/usuarios",
  "/configuracion",
];

for (const [i, ruta] of RUTAS.entries()) {
  test(`25.${4 + i} ${ruta} no desborda de costado en un celular`, async ({ page, token }) => {
    await page.setViewportSize(CELULAR);
    await injectToken(page, token);
    await page.goto(ruta);

    // Se espera a que el <main> exista y a que no quede ningún "Cargando...": varias de
    // estas pantallas dibujan su tabla recién cuando llega la respuesta, y medir antes daría
    // un verde falso sobre una pantalla todavía vacía.
    await page.locator("main").waitFor({ timeout: 15_000 });
    await page
      .getByText(/^Cargando/)
      .waitFor({ state: "hidden", timeout: 15_000 })
      .catch(() => {});

    expect(await desbordeHorizontal(page), `desborde en ${ruta}`).toBe(0);
  });
}
