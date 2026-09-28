import { test, expect } from "../fixtures/test-fixtures";
import { gotoDashboardAuthed } from "../fixtures/ui-helpers";

// Sección 24 — Frescura del dato del salón (T26-205)
//
// Qué se está probando y por qué importa. El salón se repinta solo cada 3 segundos, y el
// refresco traga los fallos de red a propósito: un corte puntual se resuelve en el próximo
// tick y un cartel por cada uno sería ruido. El problema es lo que pasaba cuando el corte
// no era puntual — la pantalla seguía mostrando las mesas de hacía diez minutos con la
// misma confianza que si fueran de hacía tres segundos. No se veía como un error, se veía
// como un salón tranquilo, y alguien podía sentar gente en una mesa que ya no estaba libre.
//
// El indicador no arregla el corte: lo hace visible. Eso es lo que verifica este spec.
//
// El corte se simula abortando las requests a /mesas desde el navegador en vez de bajar el
// backend: así la caída dura exactamente lo que dura el test, no deja al backend en un
// estado raro para los specs que siguen, y no depende de poder matar un proceso.

const INDICADOR = "indicador-frescura";

// El componente da el dato por estancado tras 5 ciclos de 3s = 15s. Se espera con margen:
// lo que se afirma es que termina avisando, no en qué segundo exacto lo hace.
const ESPERA_VENCIMIENTO_MS = 25_000;

test("24.1 el salón dice qué tan viejo es el dato que muestra", async ({ page, token }) => {
  await gotoDashboardAuthed(page, token);

  const indicador = page.getByTestId(INDICADOR);
  await expect(indicador).toBeVisible();
  await expect(indicador).toContainText("Actualizado hace");

  // La edad se dice por tramos de diez segundos y como cota ("menos de 20 segundos"), no
  // con el número exacto: un contador que corre de a un segundo invita a mirarlo, y entre
  // 4 y 7 segundos no hay ninguna decisión distinta que tomar. Se afirma el formato porque
  // es lo que distingue este cartel de un cronómetro.
  await expect(indicador).toContainText(/menos de \d+0 segundos/);
});

test("24.2 si el salón deja de recibir datos, el indicador lo avisa", async ({ page, token }) => {
  // Timeout propio: este caso espera a propósito más que el default de 30s de la suite,
  // porque lo que mide es el paso del tiempo sin refresco.
  test.setTimeout(60_000);

  await gotoDashboardAuthed(page, token);

  const indicador = page.getByTestId(INDICADOR);
  await expect(indicador).toContainText("Actualizado hace");

  // Recién acá se corta: durante la carga inicial /mesas tiene que poder responder, si no
  // el salón nunca llega a dibujarse y lo que se estaría probando es otra cosa.
  await page.route("**/mesas**", (route) => route.abort());

  await expect(indicador).toContainText("Sin actualizar hace", { timeout: ESPERA_VENCIMIENTO_MS });

  // El aviso no es solo visual: el cambio de estado se anuncia una vez por una región
  // live, que es lo que un lector de pantalla necesita para enterarse. El contador de
  // segundos queda aria-hidden a propósito —anunciarlo cada segundo taparía todo lo demás—.
  await expect(page.getByRole("status")).toContainText("El salón dejó de actualizarse");

  // Y se recupera solo cuando la red vuelve: un indicador que se queda pegado en rojo
  // después de que el problema pasó enseña a ignorarlo.
  await page.unroute("**/mesas**");
  await expect(indicador).toContainText("Actualizado hace", { timeout: 15_000 });
});

test("24.3 en modo edición el indicador dice que está en pausa, no que falla", async ({ page, token }) => {
  await gotoDashboardAuthed(page, token);

  const indicador = page.getByTestId(INDICADOR);
  await expect(indicador).toContainText("Actualizado hace");

  // El modo edición corta el refresco a propósito, para no pisar una mesa que se está
  // arrastrando. Sin distinguir los dos casos, el indicador acusaría una falla inexistente
  // justo mientras el usuario acomoda el salón, que es cuando menos hay que asustarlo.
  await page.getByRole("button", { name: "Editar disposición" }).click();
  await expect(indicador).toContainText("Actualización en pausa");

  await page.getByRole("button", { name: "Salir de edición" }).click();
  await expect(indicador).toContainText("Actualizado hace");
});
