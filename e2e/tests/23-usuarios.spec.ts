import { test, expect } from "../fixtures/test-fixtures";
import {
  ensureUsuarioDeRol,
  ensureUsuarioEditable,
  obtenerUsuarioActual,
  listarUsuarios,
  actualizarUsuario,
  credencialesEditable,
  UsuarioAdminResponse,
} from "../fixtures/api-helpers";
import { injectToken } from "../fixtures/ui-helpers";

// Sección 23 — Pantalla de administración de usuarios (T26-175)
//
// La pantalla existía sin ningún test e2e: lo detectó la auditoría de código (T26-133) al
// cruzar pantallas contra specs. Es una pantalla admin-only con tres salvaguardas de negocio
// que el backend devuelve como 409, y la UI deshabilita de antemano las dos que puede saber
// sin preguntar. Nada de eso estaba cubierto.
//
// El sujeto de las mutaciones es un usuario descartable propio (credencialesEditable) y NO
// los cuatro de credencialesDeRol: esos son los sujetos de los specs 17 y 18 y dependen de
// conservar su rol exacto.
//
// Locators por data-testid (T26-161).

const VISION_MODULE_EMAIL = "vision-module@tabletracker.com";

async function irAUsuarios(page: import("@playwright/test").Page, token: string) {
  await injectToken(page, token);
  await page.goto("/usuarios");
  await page.getByText("Cargando usuarios...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

/** La tarjeta de un usuario, por su id. */
function tarjetaDe(page: import("@playwright/test").Page, usuarioId: number) {
  return page.getByTestId(`usuario-fila-${usuarioId}`);
}

test.describe("pantalla de usuarios", () => {
  let editable: UsuarioAdminResponse;

  test.beforeEach(async ({ request, token }) => {
    editable = await ensureUsuarioEditable(request, token);
    // Estado conocido de partida: activo y mozo. Si una corrida anterior murió a mitad de
    // camino, esto la deja en su sitio antes de empezar.
    await actualizarUsuario(request, token, editable.id, { rol: "mozo", activo: true });
  });

  test.afterEach(async ({ request, token }) => {
    await actualizarUsuario(request, token, editable.id, { rol: "mozo", activo: true }).catch(() => {});
  });

  test("23.1 acceder a /usuarios sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/usuarios");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("23.2 un rol no admin no entra a la pantalla", async ({ page, request, token }) => {
    // AdminRoute tapa la pantalla entera porque GET /usuarios/ es admin-only: dejar entrar a
    // un mozo sería mostrarle un listado vacío con un error, no una pantalla degradada.
    const tokenMozo = await ensureUsuarioDeRol(request, token, "mozo");
    await irAUsuarios(page, tokenMozo);

    await expect(page.getByText("Esta pantalla es solo para administradores.")).toBeVisible();
  });

  test("23.3 el listado muestra los usuarios que devuelve la API", async ({ page, token, request }) => {
    const usuarios = await listarUsuarios(request, token);
    await irAUsuarios(page, token);

    // Un botón de acción por usuario activo listado.
    await expect(page.getByRole("button", { name: /^(Desactivar|Reactivar)$/ })).toHaveCount(usuarios.length);
    await expect(page.getByText(credencialesEditable().email)).toBeVisible();
  });

  test("23.4 la fila propia se marca y no se puede desactivar", async ({ page, token, request }) => {
    // Regla del backend: nadie se desactiva a sí mismo, porque si se equivoca queda sin
    // sesión y sin forma de deshacerlo. La UI lo deshabilita en vez de dejar que se coma
    // el 409.
    // Quién es "uno mismo" lo dice el backend, no se adivina por el email: la base tiene
    // varios admins y elegir el primero agarraba otro.
    const yo = await obtenerUsuarioActual(request, token);
    await irAUsuarios(page, token);

    const propia = tarjetaDe(page, yo.id);
    await expect(propia.getByText("(vos)")).toBeVisible();
    await expect(propia.getByRole("button", { name: /^(Desactivar|Reactivar)$/ })).toBeDisabled();
    const deshabilitados = await page
      .getByRole("button", { name: /^(Desactivar|Reactivar)$/ })
      .evaluateAll((botones) => botones.filter((b) => (b as HTMLButtonElement).disabled).length);
    // Al menos dos: la fila propia y la cuenta de servicio (ver 23.5).
    expect(deshabilitados).toBeGreaterThanOrEqual(2);
  });

  test("23.5 la cuenta de servicio se marca y no se puede desactivar", async ({ page, token, request }) => {
    // Si vision-module se queda sin cuenta, la detección se detiene por completo. El backend
    // lo bloquea con 409 y la pantalla lo deshabilita de antemano.
    await irAUsuarios(page, token);

    const usuarios = await listarUsuarios(request, token);
    const servicio = usuarios.find((u) => u.email === VISION_MODULE_EMAIL);
    expect(servicio, "la cuenta de servicio tiene que existir en la base").toBeTruthy();

    const tarjeta = tarjetaDe(page, servicio!.id);
    await expect(tarjeta.getByText("cuenta de servicio")).toBeVisible();
    await expect(tarjeta.getByRole("button", { name: /^(Desactivar|Reactivar)$/ })).toBeDisabled();
  });

  test("23.6 cambiar el rol de un usuario lo persiste", async ({ page, token, request }) => {
    await irAUsuarios(page, token);
    const tarjeta = tarjetaDe(page, editable.id);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/usuarios/") && r.request().method() === "PATCH"),
      tarjeta.getByRole("combobox").selectOption("recepcion"),
    ]);
    await page.getByText("Cargando usuarios...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    // Se confirma contra la API y no solo contra el select: la pantalla recarga después de
    // guardar, así que un select con el valor nuevo podría ser solo estado local.
    const usuarios = await listarUsuarios(request, token);
    expect(usuarios.find((u) => u.id === editable.id)?.rol).toBe("recepcion");
  });

  test("23.7 desactivar un usuario lo saca del listado por defecto y el filtro lo trae de vuelta", async ({
    page,
    token,
    request,
  }) => {
    await actualizarUsuario(request, token, editable.id, { activo: false });
    await irAUsuarios(page, token);

    // Con el filtro apagado (default) no aparece: el listado muestra solo activos.
    await expect(page.getByText(credencialesEditable().email)).toHaveCount(0);

    await page.getByRole("checkbox").check();
    await page.getByText("Cargando usuarios...").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    await expect(page.getByText(credencialesEditable().email)).toBeVisible();
  });

  test("23.8 un rechazo del backend se muestra en la fila y no se traga", async ({ page, token }) => {
    // La tercera salvaguarda —no dejar el sistema sin ningún admin activo— no se puede
    // anticipar desde la UI sin otra request, así que llega como 409 recién al guardar.
    //
    // Se simula la respuesta en vez de provocarla de verdad: provocarla exigiría desactivar
    // al último admin de la base, y si el test muriera a mitad de camino dejaría el sistema
    // sin forma de entrar. Lo que se verifica acá es responsabilidad de la pantalla —que el
    // detalle del backend termine a la vista y no en un catch mudo—; que el backend devuelva
    // 409 en ese caso ya lo cubre test_usuarios.py.
    const MENSAJE = "No se puede dejar el sistema sin ningún administrador activo.";
    await page.route(`**/usuarios/${editable.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: MENSAJE }),
      });
    });

    await irAUsuarios(page, token);
    const tarjeta = tarjetaDe(page, editable.id);
    await tarjeta.getByRole("combobox").selectOption("recepcion");

    await expect(tarjeta.getByText(MENSAJE)).toBeVisible();
  });
});
