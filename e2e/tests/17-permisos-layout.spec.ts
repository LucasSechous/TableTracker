import { test, expect } from "../fixtures/test-fixtures";
import {
  createSector,
  createMesa,
  actualizarSector,
  cambiarPosicionMesa,
  desactivarMesa,
  desactivarSector,
  listarMesas,
  listarSectores,
  uniqueSuffix,
  SectorResponse,
  MesaResponse,
} from "../fixtures/api-helpers";
import {
  gotoDashboardAuthed,
  getSectorBlock,
  getMesaCircle,
  getToggleModoButton,
  getSalirEdicionButton,
  getEditarSectorButton,
  getEliminarSectorButton,
  getEliminarMesaButton,
  getResizeHandle,
  entrarEnModoEdicion,
  dragBy,
} from "../fixtures/ui-helpers";

// Sección 17 — Permisos del modo edición del salón (RF-02)
//
// El backend ya rechazaba con 403 lo que no corresponde; lo que faltaba era que la UI no
// ofreciera esos controles. La matriz que se replica está en docs/roles-permisos.md:
//
//   mover/crear/editar mesas y sectores  -> requiere_rol("encargado")  => admin + encargado
//   borrar mesas y sectores              -> requiere_rol(ROL_ADMIN)    => solo admin
//
// De ahí que un encargado entre a edición y arrastre, pero no vea ninguna papelera.

test.describe("con un sector y una mesa", () => {
  let sector: SectorResponse;
  let mesa: MesaResponse;

  test.beforeEach(async ({ request, token }) => {
    const suffix = uniqueSuffix(test.info().parallelIndex);
    sector = await createSector(request, token, { nombre: `E2E Permisos ${suffix}` });
    sector = await actualizarSector(request, token, sector.id, { pos_x: 40, pos_y: 30, ancho: 500, alto: 300 });
    mesa = await createMesa(request, token, { numero: 1, sector_id: sector.id, estado: "libre" });
    mesa = await cambiarPosicionMesa(request, token, mesa.id, 60, 60);
  });

  test.afterEach(async ({ request, token }) => {
    await desactivarMesa(request, token, mesa.id);
    await desactivarSector(request, token, sector.id);
  });

  test("17.1 un mozo no ve el botón «Editar disposición»", async ({ page, tokenDeRol }) => {
    const tokenMozo = await tokenDeRol("mozo");
    await gotoDashboardAuthed(page, tokenMozo);

    // El salón se ve —monitorear es justamente lo que hace un mozo—, pero sin puerta de
    // entrada al modo edición.
    await expect(getSectorBlock(page, sector.nombre)).toBeVisible();
    await expect(getToggleModoButton(page)).toHaveCount(0);
    await expect(getSalirEdicionButton(page)).toHaveCount(0);
  });

  test("17.2 un encargado edita el layout pero no ve los botones de borrar", async ({
    page,
    request,
    token,
    tokenDeRol,
  }) => {
    const tokenEncargado = await tokenDeRol("encargado");
    await gotoDashboardAuthed(page, tokenEncargado);

    // Ve la puerta de entrada y puede entrar: PATCH /mesas y /sectores piden encargado.
    await expect(getToggleModoButton(page)).toBeVisible();
    await entrarEnModoEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);

    // Editar sector sí (PATCH), borrar no (DELETE es admin-only) — ni el del sector ni el
    // de la mesa. Este es el corazón del caso: los tres botones viven en el mismo modo
    // edición y sin embargo no todos le corresponden al mismo rol.
    await expect(getEditarSectorButton(sectorBlock)).toBeVisible();
    await expect(getEliminarSectorButton(sectorBlock)).toHaveCount(0);
    await expect(getEliminarMesaButton(sectorBlock)).toHaveCount(0);
    // El handle de resize responde al mismo PATCH /sectores/{id} que el arrastre.
    await expect(getResizeHandle(sectorBlock)).toBeVisible();

    // El arrastre tiene que mover de verdad, no solo en pantalla: se relee del backend.
    // Se consulta con el token de admin del runner porque leer /mesas no exige rol y así
    // el chequeo no depende de los permisos del usuario que se está probando.
    await dragBy(page, getMesaCircle(sectorBlock, mesa.numero), 60, 40);
    await expect
      .poll(async () => {
        const mesas = await listarMesas(request, token, { sector_id: sector.id });
        return mesas.find((m) => m.id === mesa.id)?.pos_x;
      })
      .not.toBe(mesa.pos_x);

    // Y el sector también, que es el otro PATCH que el encargado tiene permitido.
    await dragBy(page, sectorBlock, 50, 30);
    await expect
      .poll(async () => {
        const sectores = await listarSectores(request, token);
        return sectores.find((s) => s.id === sector.id)?.pos_x;
      })
      .not.toBe(sector.pos_x);
  });

  test("17.3 un admin ve todos los controles, incluidos los de borrar", async ({ page, token }) => {
    await gotoDashboardAuthed(page, token);
    await entrarEnModoEdicion(page);

    const sectorBlock = getSectorBlock(page, sector.nombre);
    await expect(getEditarSectorButton(sectorBlock)).toBeVisible();
    await expect(getEliminarSectorButton(sectorBlock)).toBeVisible();
    await expect(getEliminarMesaButton(sectorBlock)).toBeVisible();
    await expect(getResizeHandle(sectorBlock)).toBeVisible();
  });
});
