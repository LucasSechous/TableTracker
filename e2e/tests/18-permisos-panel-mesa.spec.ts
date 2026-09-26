import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  actualizarSector,
  cambiarPosicionMesa,
  desactivarMesa,
  desactivarSector,
  listarMesas,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  getSectorBlock,
  getMesaCircle,
  getPanelMesaToggle,
  getPanelMesaCerrar,
  getConfirmarLimpiezaButton,
  getMarcarReservadaButton,
  getPanelMesaEstadoButton,
  cerrarPanelMesa,
} from "../fixtures/ui-helpers";

// Sección 18 — Permisos del panel de mesa (T26-195)
//
// A diferencia del modo edición (sección 17), acá los permisos son *cruzados*: ningún rol
// operativo los tiene todos y cada uno ve una combinación distinta. La matriz del backend
// (docs/roles-permisos.md), con admin pasando implícito en las tres:
//
//   PATCH /mesas/{id}/limpieza -> encargado, limpieza
//   PATCH /mesas/{id}/reserva  -> encargado, recepcion
//   PATCH /mesas/{id}/estado   -> encargado, mozo
//
// De ahí que un mozo corrija estados pero no confirme limpieza, y que limpieza confirme
// limpieza pero no vea siquiera el desplegable de corrección.

test.describe("con una mesa libre y otra pendiente de limpieza", () => {
  let sector: SectorResponse;
  let mesaLibre: MesaResponse;
  let mesaPendiente: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Panel ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 40, pos_y: 30, ancho: 500, alto: 300 });
    mesaLibre = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    mesaLibre = await cambiarPosicionMesa(request, token, mesaLibre.id, 20, 20);
    mesaPendiente = await createMesa(request, token, {
      numero: 2,
      sector_id: sector.id,
      estado: "pendiente_limpieza",
    });
    mesaPendiente = await cambiarPosicionMesa(request, token, mesaPendiente.id, 140, 20);
  });

  test.afterEach(async ({ request, token }) => {
    await desactivarMesa(request, token, mesaLibre.id);
    await desactivarMesa(request, token, mesaPendiente.id);
    await desactivarSector(request, token, sector.id);
  });

  test("18.1 un mozo corrige estados pero no confirma limpieza ni reserva", async ({ page, tokenDeRol }) => {
    await gotoDashboardAuthed(page, await tokenDeRol("mozo"));
    const sectorBlock = getSectorBlock(page, sector.nombre);

    // Sobre la mesa pendiente: no le corresponde cerrar el ciclo de limpieza.
    await getMesaCircle(sectorBlock, mesaPendiente.numero).click();
    await expect(getPanelMesaCerrar(page)).toBeVisible();
    await expect(getConfirmarLimpiezaButton(page)).toHaveCount(0);

    // Pero sí corregir el estado a mano (RF-17), que es su tarea.
    await getPanelMesaToggle(page).click();
    await expect(getPanelMesaEstadoButton(page, "ocupada")).toBeVisible();
    await expect(getMarcarReservadaButton(page)).toHaveCount(0);
  });

  test("18.2 recepcion reserva pero no corrige estados ni confirma limpieza", async ({ page, tokenDeRol }) => {
    await gotoDashboardAuthed(page, await tokenDeRol("recepcion"));
    const sectorBlock = getSectorBlock(page, sector.nombre);

    await getMesaCircle(sectorBlock, mesaPendiente.numero).click();
    await expect(getPanelMesaCerrar(page)).toBeVisible();
    await expect(getConfirmarLimpiezaButton(page)).toHaveCount(0);

    // El desplegable existe porque puede reservar, pero adentro solo eso: los cuatro
    // botones de estado son de encargado/mozo.
    await getPanelMesaToggle(page).click();
    await expect(getMarcarReservadaButton(page)).toBeVisible();
    for (const estado of ["libre", "ocupada", "pendiente_limpieza", "reservada"]) {
      await expect(getPanelMesaEstadoButton(page, estado)).toHaveCount(0);
    }
  });

  test("18.3 limpieza confirma limpieza y no ve el desplegable de corrección", async ({ page, tokenDeRol }) => {
    await gotoDashboardAuthed(page, await tokenDeRol("limpieza"));
    const sectorBlock = getSectorBlock(page, sector.nombre);

    await getMesaCircle(sectorBlock, mesaPendiente.numero).click();
    await expect(getPanelMesaCerrar(page)).toBeVisible();
    await expect(getConfirmarLimpiezaButton(page)).toBeVisible();

    // No puede reservar ni cambiar estado, así que el desplegable entero se esconde: si se
    // mostrara, abriría una caja vacía.
    await expect(getPanelMesaToggle(page)).toHaveCount(0);

    // Hay que cerrar el panel antes de pasar a la otra mesa: mientras está abierto su
    // overlay cubre el canvas e intercepta el click.
    await cerrarPanelMesa(page);
    await expect(getPanelMesaCerrar(page)).toHaveCount(0);

    // Y sobre una mesa libre no le queda ningún control de escritura.
    await getMesaCircle(sectorBlock, mesaLibre.numero).click();
    await expect(getPanelMesaCerrar(page)).toBeVisible();
    await expect(getConfirmarLimpiezaButton(page)).toHaveCount(0);
    await expect(getPanelMesaToggle(page)).toHaveCount(0);
  });

  test("18.4 un encargado sigue viendo los tres controles", async ({ page, tokenDeRol }) => {
    await gotoDashboardAuthed(page, await tokenDeRol("encargado"));
    const sectorBlock = getSectorBlock(page, sector.nombre);

    await getMesaCircle(sectorBlock, mesaPendiente.numero).click();
    await expect(getConfirmarLimpiezaButton(page)).toBeVisible();

    await getPanelMesaToggle(page).click();
    await expect(getMarcarReservadaButton(page)).toBeVisible();
    await expect(getPanelMesaEstadoButton(page, "libre")).toBeVisible();
  });

  test("18.5 «Confirmar limpieza» sigue funcionando para quien sí puede", async ({
    page,
    request,
    token,
    tokenDeRol,
  }) => {
    // Ocultar controles no tiene que haber roto la acción de quien está habilitado: se
    // verifica contra el backend, no solo que el botón esté a la vista.
    await gotoDashboardAuthed(page, await tokenDeRol("limpieza"));
    const sectorBlock = getSectorBlock(page, sector.nombre);

    await getMesaCircle(sectorBlock, mesaPendiente.numero).click();
    await getConfirmarLimpiezaButton(page).click();

    // Se relee con el token de admin del runner: leer /mesas no exige un rol en
    // particular, así que el chequeo no depende de los permisos del rol probado.
    await expect
      .poll(async () => {
        const mesas = await listarMesas(request, token, { sector_id: sector.id });
        return mesas.find((m) => m.id === mesaPendiente.id)?.estado;
      })
      .toBe("libre");
  });
});
