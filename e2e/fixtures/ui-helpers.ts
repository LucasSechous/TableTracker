import type { Page, Locator } from "@playwright/test";

/** Inyecta el token en localStorage antes de que cargue cualquier script de la app. */
export async function injectToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem("token", t);
  }, token);
}

export async function gotoDashboardAuthed(page: Page, token: string): Promise<void> {
  await injectToken(page, token);
  await page.goto("/");
  await waitForSalonLoaded(page);
}

export async function waitForSalonLoaded(page: Page): Promise<void> {
  await page.getByText("Cargando salón...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

/** Locator del bloque raíz de un SectorBloque, ubicado por el texto exacto de su nombre. */
export function getSectorBlock(page: Page, nombreSector: string): Locator {
  return page.getByText(nombreSector, { exact: true }).locator("xpath=..");
}

/** Locator del círculo de una mesa (border-radius:50%) dentro de un sector, por número exacto. */
export function getMesaCircle(sectorBlock: Locator, numero: number): Locator {
  return sectorBlock
    .locator('div[style*="50%"]')
    .filter({ hasText: new RegExp(`^${numero}$`) });
}

/** Locator del handle de resize (esquina inferior derecha) de un SectorBloque, en modo edición. */
export function getResizeHandle(sectorBlock: Locator): Locator {
  return sectorBlock.locator('div[style*="nwse-resize"]');
}

/** Locator del botón de editar (lápiz, esquina superior derecha) de un SectorBloque, en modo edición. */
export function getEditarSectorButton(sectorBlock: Locator): Locator {
  return sectorBlock.locator('button[title="Editar sector"]');
}

/** Locator del botón de eliminar (tacho, esquina superior derecha) de un SectorBloque, en modo edición. */
export function getEliminarSectorButton(sectorBlock: Locator): Locator {
  return sectorBlock.locator('button[title="Eliminar sector"]');
}

/**
 * Abre (o cierra) el <select> de estado haciendo click en el círculo de la mesa (modo monitoreo).
 * El <select> vive dentro de un <div> wrapper hermano del círculo (junto al botón "Marcar como
 * reservada" en MesaVisual.tsx), no como hermano directo, así que se baja un nivel más.
 */
export function getEstadoSelect(mesaCircle: Locator): Locator {
  return mesaCircle.locator("xpath=following-sibling::div//select");
}

export function getToggleModoButton(page: Page): Locator {
  return page.getByRole("button", { name: /Editar disposición|Ver monitoreo/ });
}

export function getLogoutButton(page: Page): Locator {
  return page.getByRole("button", { name: "Cerrar sesión" });
}

export function getEmailInput(page: Page): Locator {
  return page.locator('input[type="email"]');
}

export function getPasswordInput(page: Page): Locator {
  return page.locator('input[type="password"]');
}

export function getSubmitButton(page: Page): Locator {
  return page.getByRole("button", { name: /Ingresar/ });
}

/**
 * Simula un drag nativo (mousedown -> mousemove x N -> mouseup) sobre un elemento,
 * replicando cómo SectorBloque/MesaVisual escuchan mousemove/mouseup en window.
 */
export async function dragBy(page: Page, target: Locator, dx: number, dy: number, steps = 8): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("No se pudo obtener el bounding box del elemento a arrastrar");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps });
  await page.mouse.up();
}

export const COLOR_POR_ESTADO: Record<string, string> = {
  libre: "rgb(76, 175, 80)",
  ocupada: "rgb(244, 67, 54)",
  pendiente_limpieza: "rgb(255, 152, 0)",
  reservada: "rgb(33, 150, 243)",
};

export const ESTADO_LABEL: Record<string, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pendiente_limpieza: "Pendiente de limpieza",
  reservada: "Reservada",
};

export async function gotoHistorialAuthed(page: Page, token: string): Promise<void> {
  await injectToken(page, token);
  await page.goto("/historial");
  await waitForHistorialLoaded(page);
}

export async function waitForHistorialLoaded(page: Page): Promise<void> {
  await page.getByText("Cargando historial...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

export function getMesaFilterSelect(page: Page): Locator {
  return page.getByLabel("Mesa");
}

export function getFechaDesdeInput(page: Page): Locator {
  return page.getByLabel("Desde");
}

export function getFechaHastaInput(page: Page): Locator {
  return page.getByLabel("Hasta");
}

export function getBuscarButton(page: Page): Locator {
  return page.getByRole("button", { name: "Buscar" });
}

export function getLimpiarFiltrosButton(page: Page): Locator {
  return page.getByRole("button", { name: "Limpiar filtros" });
}

export async function gotoOcupacionAuthed(page: Page, token: string): Promise<void> {
  await injectToken(page, token);
  await page.goto("/ocupacion");
  await waitForOcupacionLoaded(page);
}

export async function waitForOcupacionLoaded(page: Page): Promise<void> {
  await page.getByText("Cargando métricas...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

/**
 * Los locators del panel de ocupación van por data-testid y se indexan por la CLAVE del
 * estado (libre, ocupada, ...), no por su etiqueta visible. Dos razones, las dos de
 * T26-161: no navegar el DOM por posición (los XPath posicionales fueron los que
 * rompieron en el Sprint 5) y no acoplar el spec al texto de la UI, que puede cambiar
 * sin que cambie el comportamiento.
 */
export const ESTADOS_OCUPACION = ["libre", "ocupada", "pendiente_limpieza", "reservada"] as const;

/** Etiqueta (en plural) de la card de cada estado, para los asserts de texto visible. */
export const ETIQUETA_CARD_OCUPACION: Record<string, string> = {
  libre: "Libres",
  ocupada: "Ocupadas",
  pendiente_limpieza: "Pendientes de limpieza",
  reservada: "Reservadas",
};

/** Card completa de un estado en el panel de ocupación. */
export function getOcupacionCard(page: Page, estado: string): Locator {
  return page.getByTestId(`ocupacion-card-${estado}`);
}

/** El número grande de la card de un estado. */
export function getOcupacionCardCount(page: Page, estado: string): Locator {
  return page.getByTestId(`ocupacion-count-${estado}`);
}

/** El cuadradito de color de la card, que debe usar la paleta del salón. */
export function getOcupacionCardSwatch(page: Page, estado: string): Locator {
  return page.getByTestId(`ocupacion-swatch-${estado}`);
}

/** La etiqueta de texto de la card de un estado. */
export function getOcupacionCardEtiqueta(page: Page, estado: string): Locator {
  return page.getByTestId(`ocupacion-etiqueta-${estado}`);
}

/** El porcentaje general (el número grande del encabezado). */
export function getOcupacionPorcentaje(page: Page): Locator {
  return page.getByTestId("ocupacion-porcentaje");
}

/** El "N de M mesas ocupadas" que acompaña al porcentaje. */
export function getOcupacionResumen(page: Page): Locator {
  return page.getByTestId("ocupacion-resumen");
}

/** El "N mesas activas en total" del encabezado de la grilla de cards. */
export function getOcupacionTotal(page: Page): Locator {
  return page.getByTestId("ocupacion-total");
}

/** El empty state que reemplaza al panel cuando no hay ninguna mesa activa. */
export function getOcupacionEmptyState(page: Page): Locator {
  return page.getByTestId("ocupacion-empty");
}

/** La aclaración pegada al porcentaje sobre qué mesas cuenta y cuáles no. */
export function getOcupacionNotaPorcentaje(page: Page): Locator {
  return page.getByTestId("ocupacion-nota-porcentaje");
}

/** El recordatorio dentro de la card de Reservadas. */
export function getOcupacionNotaReservada(page: Page): Locator {
  return page.getByTestId("ocupacion-nota-reservada");
}

/** Todas las filas del cuerpo de la tabla de historial. */
export function getHistorialRows(page: Page): Locator {
  return page.locator("table tbody tr");
}

/** Locator de la fila de historial cuya mesa y estado (texto exacto de cada celda) coinciden. */
export function getHistorialRow(page: Page, mesaId: number, estadoLabel: string): Locator {
  return getHistorialRows(page)
    .filter({ has: page.locator("td", { hasText: new RegExp(`^${mesaId}$`) }) })
    .filter({ has: page.locator("td", { hasText: new RegExp(`^${estadoLabel}$`) }) });
}
