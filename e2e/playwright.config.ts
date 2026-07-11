import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendDir = path.join(repoRoot, "frontend");
const backendDir = path.join(repoRoot, "backend");
const backendPython = path.join(backendDir, "venv", "Scripts", "python.exe");

export const FRONTEND_URL = "http://localhost:5173";
export const BACKEND_URL = "http://127.0.0.1:8000";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // DashboardPage renderiza TODOS los sectores/mesas de la base en posiciones absolutas
  // de un único canvas compartido (1200x700, overflow:hidden, sin recorte scrolleable).
  // Si dos workers corrieran en paralelo, los sectores de prueba de uno podrían solaparse
  // visualmente con los del otro e interceptarse los clicks entre sí, sin forma fiable de
  // aislarlos dentro de esas dimensiones fijas. Por eso la suite corre en un solo worker.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // La suite habla con un backend/DB reales (no mocks) para la mayoría de los casos,
  // así que se tolera un reintento ante latencia de red puntual.
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 5173 --strictPort",
      cwd: frontendDir,
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `"${backendPython}" -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: backendDir,
      url: BACKEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
