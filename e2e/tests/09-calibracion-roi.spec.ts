import { test, expect } from "../fixtures/test-fixtures";
import { listarCamaras, listarMesas, listarRois, desactivarRoi } from "../fixtures/api-helpers";
import { injectToken } from "../fixtures/ui-helpers";

// Sección 9 — Calibración de ROI (T26-128 v1, solo creación)
//
// A diferencia del resto de la suite, este test habla con una cámara IP real (Tapo C310, ver
// T26-134) ya dada de alta en Supabase con el nombre fijo de abajo — no crea una cámara propia
// porque no hay forma de armar una URL RTSP funcional sin las credenciales reales, que viven
// solo en la fila ya existente. Si esa cámara no está en la red al correr la suite, este test
// se salta en vez de fallar (ver test.skip más abajo).
//
// El nombre de esta cámara pasó de "Tapo test E2E (T26-134)" a "Cocina" (su nombre real de
// producción) vía scripts/renombrar_camara.py una vez que T26-128 terminó de probarse contra
// ella — este test busca por nombre, así que hay que mantenerlo en sync si se vuelve a
// renombrar.
const NOMBRE_CAMARA_REAL = "Cocina";

test("9.1 un admin crea una zona ROI nueva dibujando sobre un frame real de la cámara", async ({
  page,
  token,
  request,
}) => {
  const camaras = await listarCamaras(request, token);
  const camara = camaras.find((c) => c.nombre === NOMBRE_CAMARA_REAL && c.activa);
  test.skip(!camara, `No está la cámara de prueba "${NOMBRE_CAMARA_REAL}" activa en la base — nada que probar.`);
  if (!camara) return;

  const mesas = await listarMesas(request, token, { sector_id: camara.sector_id });
  const roisDeLaCamara = await listarRois(request, token, { camara_id: camara.id });
  const mesaSinRoi = mesas.find((m) => !roisDeLaCamara.some((r) => r.mesa_id === m.id));
  test.skip(!mesaSinRoi, "Todas las mesas del sector de la cámara ya tienen un ROI activo.");
  if (!mesaSinRoi) return;

  let roiCreadoId: number | null = null;
  try {
    await injectToken(page, token);
    await page.goto("/calibracion-roi");

    await page.getByLabel("Cámara").selectOption({ label: camara.nombre });
    await page.getByLabel("Mesa").selectOption({ label: `Mesa ${mesaSinRoi.numero} (${mesaSinRoi.sector.nombre})` });

    await page.getByRole("button", { name: "Actualizar frame" }).click();
    const frame = page.getByAltText("Frame de referencia de la cámara");
    await expect(frame, "el snapshot real de la cámara debería cargar como imagen").toBeVisible({ timeout: 20_000 });

    // Dibuja un rectángulo de 4 puntos sobre el overlay SVG (que ocupa el mismo box que <img>).
    const box = await frame.boundingBox();
    if (!box) throw new Error("No se pudo obtener el bounding box del frame");
    const puntos: [number, number][] = [
      [box.x + box.width * 0.3, box.y + box.height * 0.3],
      [box.x + box.width * 0.6, box.y + box.height * 0.3],
      [box.x + box.width * 0.6, box.y + box.height * 0.6],
      [box.x + box.width * 0.3, box.y + box.height * 0.6],
    ];
    for (const [x, y] of puntos) {
      await page.mouse.click(x, y);
    }

    await expect(page.getByText("4 puntos (mínimo 3)")).toBeVisible();

    // Con 3+ puntos, el polígono en progreso debería mostrar el número de la mesa elegida
    // (no su mesa_id interno) centrado sobre él, como etiqueta SVG.
    const etiquetaMesa = page.locator("svg text").filter({ hasText: new RegExp(`^${mesaSinRoi.numero}$`) });
    await expect(etiquetaMesa, "la etiqueta con el número de mesa debería verse sobre el polígono en progreso").toBeVisible();

    const finalizarBtn = page.getByRole("button", { name: "Finalizar zona" });
    await expect(finalizarBtn).toBeEnabled();
    await finalizarBtn.click();

    await expect(page.getByText(/Zona guardada para la mesa/)).toBeVisible({ timeout: 10_000 });

    const roisTrasGuardar = await listarRois(request, token, { camara_id: camara.id, mesa_id: mesaSinRoi.id });
    expect(roisTrasGuardar.length).toBeGreaterThan(0);
    const roi = roisTrasGuardar[0];
    roiCreadoId = roi.id;

    // Los 4 puntos clickeados forman un rectángulo dentro del frame: la transformación
    // pantalla→frame real debe conservar esa forma (mismo orden, coordenadas no negativas,
    // y separadas entre sí — no los 4 puntos colapsados en el mismo pixel por un cálculo roto).
    expect(roi.coordenadas.length).toBe(4);
    for (const [x, y] of roi.coordenadas) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
    }
    const xs = new Set(roi.coordenadas.map((p) => p[0]));
    const ys = new Set(roi.coordenadas.map((p) => p[1]));
    expect(xs.size, "los 4 puntos no deberían colapsar en la misma coordenada x").toBeGreaterThan(1);
    expect(ys.size, "los 4 puntos no deberían colapsar en la misma coordenada y").toBeGreaterThan(1);
  } finally {
    if (roiCreadoId) await desactivarRoi(request, token, roiCreadoId);
  }
});

test("9.2 acceder a /calibracion-roi sin sesión redirige a /login", async ({ page }) => {
  // Confirma que esta ruta nueva quedó envuelta en PrivateRoute (mismo mecanismo que ya
  // cubre 03-protected-routes.spec.ts para otras rutas) — hubiera fallado, por ejemplo, si
  // me olvidaba de envolver <CalibracionRoiPage /> al agregar la ruta en App.tsx.
  //
  // El rechazo específico por rol (AdminRoute, no-admin logueado) no tiene test automatizado:
  // no hay endpoint para borrar usuarios (ver docs/roles-permisos.md), así que crear un
  // usuario no-admin de prueba lo dejaría permanentemente en la base real — a diferencia de
  // TEST_USER (una única excepción ya documentada en e2e/README.md), no vale la pena sumar
  // otro usuario huérfano por un solo assert. AdminRoute usa el mismo chequeo
  // (user.rol === "admin") que ya está probado indirectamente en el resto de la app.
  await page.goto("/calibracion-roi");
  await expect(page).toHaveURL(/\/login$/);
});
