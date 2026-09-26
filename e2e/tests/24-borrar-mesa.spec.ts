import { test, expect } from "../fixtures/test-fixtures";
import {
  actualizarSector,
  cambiarPosicionMesa,
  createMesa,
  createSector,
  deleteMesa,
  deleteSector,
  listarMesas,
  listarSectores,
  uniqueSuffix,
  MesaResponse,
  SectorResponse,
} from "../fixtures/api-helpers";
import {
  cancelarEnModal,
  confirmarEnModal,
  dragBy,
  entrarEnModoEdicion,
  getEliminarMesaButtonDe,
  getMesaCircle,
  getModalConfirmacion,
  getSectorBlock,
  gotoDashboardAuthed,
} from "../fixtures/ui-helpers";

// Sección 24 — Borrar una mesa desde el canvas (T26-200)
//
// Este camino no tenía ningún test: mientras la confirmación fue un window.confirm, ejercitarlo
// exigía interceptar el diálogo nativo del navegador, y nadie lo escribió. El botón existía en
// el spec 17 solo como assert de visibilidad, nunca clickeado. Que ahora sea un modal propio
// (T26-200/F-10) es lo que lo vuelve testeable como cualquier otro flujo.
//
// El caso 24.4 es una regresión concreta, no una hipótesis: el ModalConfirmacion de una mesa se
// renderiza DENTRO del bloque de su sector, que en modo edición arranca a arrastrarse con
// cualquier mousedown que le llegue. Apretar "Eliminar" iniciaba un drag del sector por debajo
// del modal y mandaba un PATCH de posición al soltar. Se corrigió parando la propagación en el
// overlay de Modal.tsx.

test.describe("borrar una mesa desde el canvas", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;
  let otraMesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E BorrarMesa ${suffix}` });
    // Posición fija y con margen: el caso 24.4 afirma que el sector NO se movió, y un sector
    // pegado a un borde podría quedarse quieto por el clamp aunque el drag sí se haya
    // disparado, dando un verde que no significa nada.
    sector = await actualizarSector(request, token, sector.id, { pos_x: 60, pos_y: 60 });
    // Dos mesas: una para borrar y otra que tiene que sobrevivir. Con una sola, un bug que
    // borrara de más pasaría desapercibido.
    //
    // Hay que posicionarlas a mano (mismo patrón que el spec 04): MesaCreate no acepta
    // pos_x/pos_y, así que las dos nacen en (0,0) y quedan una encima de la otra. Superpuestas,
    // el botón de borrar de la de arriba tapa al de la de abajo y el click no llega nunca.
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    mesa = await cambiarPosicionMesa(request, token, mesa.id, 20, 20);
    otraMesa = await createMesa(request, token, { numero: 2, sector_id: sector.id, estado: "libre" });
    otraMesa = await cambiarPosicionMesa(request, token, otraMesa.id, 220, 20);
  });

  test.afterEach(async ({ request, token }) => {
    await deleteMesa(request, token, mesa.id).catch(() => {});
    await deleteMesa(request, token, otraMesa.id).catch(() => {});
    await deleteSector(request, token, sector.id).catch(() => {});
  });

  test("24.1 el botón de borrar abre el modal de confirmación, que nombra la mesa", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    await entrarEnModoEdicion(page);

    // Antes de apretar no hay ningún modal: si lo hubiera, el resto de los asserts de esta
    // sección estarían mirando algo que ya estaba abierto.
    await expect(getModalConfirmacion(page)).toHaveCount(0);

    await getEliminarMesaButtonDe(page, mesa.numero).click();

    const modal = getModalConfirmacion(page);
    await expect(modal).toBeVisible();
    // El número va en el mensaje y no solo en el título: es lo único que distingue esta
    // confirmación de la de la mesa de al lado.
    await expect(modal).toContainText(`¿Eliminar la mesa ${mesa.numero}?`);
    await expect(modal).toContainText("Eliminar mesa");
  });

  test("24.2 confirmar saca la mesa del canvas y la desactiva en el backend", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    await entrarEnModoEdicion(page);
    await getEliminarMesaButtonDe(page, mesa.numero).click();

    // El botón NO manda un DELETE aunque se llame "Eliminar": el frontend hace baja lógica
    // con PATCH /mesas/{id} {activa:false} y esquiva el DELETE /mesas/{id}, que es
    // hard-delete y solo admin (ver mesasApi.desactivar y el hallazgo B-4 de la auditoría).
    // El assert va contra lo que el código hace de verdad, no contra lo que el botón sugiere.
    const [respuesta] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/mesas/${mesa.id}`) && r.request().method() === "PATCH"),
      confirmarEnModal(page),
    ]);
    expect(respuesta.status()).toBe(200);
    expect(respuesta.request().postDataJSON()).toEqual({ activa: false });

    const sectorBlock = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(sectorBlock, mesa.numero)).toHaveCount(0);
    await expect(getModalConfirmacion(page)).toHaveCount(0);
    // La otra mesa sigue dibujada: se borró una, no las del sector.
    await expect(getMesaCircle(sectorBlock, otraMesa.numero)).toBeVisible();

    // Baja lógica, no borrado: desaparece del listado por defecto pero la fila sigue estando.
    const activas = await listarMesas(request, token, { sector_id: sector.id });
    expect(activas.find((m) => m.id === mesa.id)).toBeUndefined();
    expect(activas.find((m) => m.id === otraMesa.id)).toBeDefined();

    const todas = await listarMesas(request, token, { sector_id: sector.id, incluir_inactivos: true });
    expect(todas.find((m) => m.id === mesa.id)?.activa).toBe(false);
  });

  test("24.3 cancelar cierra el modal, deja la mesa y no manda ningún request de escritura", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    await entrarEnModoEdicion(page);
    await getEliminarMesaButtonDe(page, mesa.numero).click();
    await expect(getModalConfirmacion(page)).toBeVisible();

    // Se miran solo los métodos de escritura: el dashboard repite GET /mesas/ cada 3s en
    // monitoreo, así que contar todas las requests haría fallar el test por el refresco.
    const escrituras: string[] = [];
    const registrar = (metodo: string, url: string) => {
      if (metodo !== "GET") escrituras.push(`${metodo} ${url}`);
    };
    page.on("request", (r) => registrar(r.method(), r.url()));

    await cancelarEnModal(page);

    await expect(getModalConfirmacion(page)).toHaveCount(0);
    const sectorBlock = getSectorBlock(page, sector.nombre);
    await expect(getMesaCircle(sectorBlock, mesa.numero)).toBeVisible();
    expect(escrituras).toEqual([]);

    // Y no solo en pantalla: la mesa sigue activa del lado del backend.
    const activas = await listarMesas(request, token, { sector_id: sector.id });
    expect(activas.find((m) => m.id === mesa.id)?.activa).toBe(true);
  });

  test("24.4 arrastrar sobre el modal abierto no mueve el sector que está debajo", async ({
    page,
    token,
    request,
  }) => {
    await gotoDashboardAuthed(page, token);
    await entrarEnModoEdicion(page);
    await getEliminarMesaButtonDe(page, mesa.numero).click();
    await expect(getModalConfirmacion(page)).toBeVisible();

    const patchesDeSector: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes(`/sectores/${sector.id}`)) {
        patchesDeSector.push(r.url());
      }
    });

    // mousedown + move + mouseup sobre la caja del modal. Es el gesto que disparaba el bug:
    // el evento subía por el árbol de React hasta el onMouseDown del bloque del sector, que
    // no distingue si vino de una mesa, de un botón o de un modal encima de todo.
    await dragBy(page, getModalConfirmacion(page), 80, 50);

    // La señal fuerte es esta: el drag del sector termina llamando a PATCH /sectores/{id} con
    // la posición nueva. Sin el stopPropagation del overlay, acá habría exactamente una.
    expect(patchesDeSector).toEqual([]);

    // Y la posición guardada sigue siendo la que fijó el beforeEach.
    const sectores = await listarSectores(request, token);
    const guardado = sectores.find((s) => s.id === sector.id)!;
    expect({ pos_x: guardado.pos_x, pos_y: guardado.pos_y }).toEqual({ pos_x: 60, pos_y: 60 });

    // El modal sobrevive al gesto: arrastrarlo no es cancelarlo.
    await expect(getModalConfirmacion(page)).toBeVisible();
  });
});
