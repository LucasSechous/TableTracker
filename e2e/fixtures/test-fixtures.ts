import { test as base, expect } from "@playwright/test";
import { ensureTestUser, ensureUsuarioDeRol, loginViaApi } from "./api-helpers";
import type { RolDePrueba } from "./api-helpers";

type TestFixtures = {
  userEnsured: void;
  token: string;
  /** Token de un usuario con otro rol, creado on-demand. Ver ensureUsuarioDeRol. */
  tokenDeRol: (rol: RolDePrueba) => Promise<string>;
};

export const test = base.extend<TestFixtures>({
  userEnsured: async ({ request }, use) => {
    await ensureTestUser(request);
    await use();
  },
  token: async ({ request, userEnsured }, use) => {
    const token = await loginViaApi(request);
    await use(token);
  },
  // Depende de `token` porque crear un usuario exige un admin autenticado.
  tokenDeRol: async ({ request, token }, use) => {
    await use((rol: RolDePrueba) => ensureUsuarioDeRol(request, token, rol));
  },
});

export { expect };
