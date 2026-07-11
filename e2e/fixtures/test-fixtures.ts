import { test as base, expect } from "@playwright/test";
import { ensureTestUser, loginViaApi } from "./api-helpers";

type TestFixtures = {
  userEnsured: void;
  token: string;
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
});

export { expect };
