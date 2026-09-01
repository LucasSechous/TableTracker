import type { APIRequestContext } from "@playwright/test";
import { BACKEND_URL } from "../playwright.config";

const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;
if (!testEmail || !testPassword) {
  throw new Error(
    "Faltan E2E_TEST_EMAIL / E2E_TEST_PASSWORD. Copiá e2e/.env.example a e2e/.env y completá los valores."
  );
}

export const TEST_USER = {
  nombre: "E2E Test Runner",
  email: testEmail,
  password: testPassword,
  rol: "admin",
};

export interface SectorResponse {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
}

export interface MesaResponse {
  id: number;
  numero: number;
  sector_id: number;
  sector: SectorResponse;
  estado: string;
  activa: boolean;
  pos_x: number;
  pos_y: number;
}

/**
 * Verifica que el usuario fijo de e2e ya exista y pueda loguearse.
 *
 * Antes se autoregistraba vía POST /auth/register, pero ese endpoint ahora exige
 * rol admin (T26-116: RF-02, restricciones por rol), así que ya no hay forma de
 * autoregistrarse sin token. El usuario de test debe crearse una única vez con el
 * script de bootstrap: `python -m app.seed_admin` (ver backend/app/seed_admin.py y
 * e2e/README.md).
 */
export async function ensureTestUser(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND_URL}/auth/login`, {
    data: { email: TEST_USER.email, password: TEST_USER.password },
  });
  if (res.ok()) return;
  throw new Error(
    `El usuario de test (${TEST_USER.email}) no existe o las credenciales no coinciden ` +
      `(${res.status()}). POST /auth/register ya no permite autoregistro; corré una vez ` +
      `"ADMIN_EMAIL=... ADMIN_PASSWORD=... python -m app.seed_admin" desde backend/ con esas ` +
      `mismas credenciales (ver e2e/README.md).`
  );
}

export async function loginViaApi(
  request: APIRequestContext,
  email: string = TEST_USER.email,
  password: string = TEST_USER.password
): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/auth/login`, { data: { email, password } });
  if (!res.ok()) {
    throw new Error(`Login vía API falló: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.access_token as string;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function createSector(
  request: APIRequestContext,
  token: string,
  datos: { nombre: string; descripcion?: string }
): Promise<SectorResponse> {
  const res = await request.post(`${BACKEND_URL}/sectores/`, {
    headers: authHeaders(token),
    data: datos,
  });
  if (!res.ok()) throw new Error(`No se pudo crear sector: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function actualizarSector(
  request: APIRequestContext,
  token: string,
  sectorId: number,
  datos: Partial<Pick<SectorResponse, "pos_x" | "pos_y" | "ancho" | "alto" | "nombre">>
): Promise<SectorResponse> {
  const res = await request.patch(`${BACKEND_URL}/sectores/${sectorId}`, {
    headers: authHeaders(token),
    data: datos,
  });
  if (!res.ok()) throw new Error(`No se pudo actualizar sector: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function deleteSector(request: APIRequestContext, token: string, sectorId: number): Promise<void> {
  await request.delete(`${BACKEND_URL}/sectores/${sectorId}`, { headers: authHeaders(token) });
}

/** Soft-delete: desactiva el sector (activo=false) en vez de borrarlo físicamente. */
export async function desactivarSector(
  request: APIRequestContext,
  token: string,
  sectorId: number
): Promise<SectorResponse> {
  const res = await request.patch(`${BACKEND_URL}/sectores/${sectorId}`, {
    headers: authHeaders(token),
    data: { activo: false },
  });
  if (!res.ok()) throw new Error(`No se pudo desactivar sector: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function createMesa(
  request: APIRequestContext,
  token: string,
  datos: { numero: number; sector_id: number; estado?: string; activa?: boolean }
): Promise<MesaResponse> {
  const res = await request.post(`${BACKEND_URL}/mesas/`, {
    headers: authHeaders(token),
    data: datos,
  });
  if (!res.ok()) throw new Error(`No se pudo crear mesa: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function cambiarEstadoMesa(
  request: APIRequestContext,
  token: string,
  mesaId: number,
  estado: string
): Promise<MesaResponse> {
  const res = await request.patch(`${BACKEND_URL}/mesas/${mesaId}/estado`, {
    headers: authHeaders(token),
    data: { estado },
  });
  if (!res.ok()) throw new Error(`No se pudo cambiar estado: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function cambiarPosicionMesa(
  request: APIRequestContext,
  token: string,
  mesaId: number,
  pos_x: number,
  pos_y: number
): Promise<MesaResponse> {
  const res = await request.patch(`${BACKEND_URL}/mesas/${mesaId}/posicion`, {
    headers: authHeaders(token),
    data: { pos_x, pos_y },
  });
  if (!res.ok()) throw new Error(`No se pudo cambiar posición: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function deleteMesa(request: APIRequestContext, token: string, mesaId: number): Promise<void> {
  await request.delete(`${BACKEND_URL}/mesas/${mesaId}`, { headers: authHeaders(token) });
}

/** Soft-delete: desactiva la mesa (activa=false) en vez de borrarla físicamente. */
export async function desactivarMesa(
  request: APIRequestContext,
  token: string,
  mesaId: number
): Promise<MesaResponse> {
  const res = await request.patch(`${BACKEND_URL}/mesas/${mesaId}`, {
    headers: authHeaders(token),
    data: { activa: false },
  });
  if (!res.ok()) throw new Error(`No se pudo desactivar mesa: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function listarMesas(
  request: APIRequestContext,
  token: string,
  params?: { sector_id?: number; incluir_inactivos?: boolean }
): Promise<MesaResponse[]> {
  const res = await request.get(`${BACKEND_URL}/mesas/`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo listar mesas: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function listarSectores(
  request: APIRequestContext,
  token: string,
  params?: { incluir_inactivos?: boolean }
): Promise<SectorResponse[]> {
  const res = await request.get(`${BACKEND_URL}/sectores/`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo listar sectores: ${res.status()} ${await res.text()}`);
  return res.json();
}

/** Sufijo único por corrida/worker para no colisionar nombres/números contra datos reales o entre workers. */
export function uniqueSuffix(workerIndex: number): string {
  return `${Date.now()}_${workerIndex}`;
}

export interface CamaraResponse {
  id: number;
  nombre: string;
  sector_id: number;
  sector: SectorResponse;
  rtsp_url: string;
  tiene_credenciales: boolean;
  activa: boolean;
}

export async function listarCamaras(
  request: APIRequestContext,
  token: string,
  params?: { sector_id?: number; incluir_inactivas?: boolean }
): Promise<CamaraResponse[]> {
  const res = await request.get(`${BACKEND_URL}/camaras/`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo listar cámaras: ${res.status()} ${await res.text()}`);
  return res.json();
}

export interface RoiMesaResponse {
  id: number;
  mesa_id: number;
  camara_id: number;
  coordenadas: number[][];
  activa: boolean;
}

export async function listarRois(
  request: APIRequestContext,
  token: string,
  params?: { mesa_id?: number; camara_id?: number; incluir_inactivos?: boolean }
): Promise<RoiMesaResponse[]> {
  const res = await request.get(`${BACKEND_URL}/roi-mesa/`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo listar ROI: ${res.status()} ${await res.text()}`);
  return res.json();
}

/** Soft-delete: desactiva el ROI (activa=false) en vez de borrarlo físicamente. */
export async function desactivarRoi(request: APIRequestContext, token: string, roiId: number): Promise<void> {
  await request.delete(`${BACKEND_URL}/roi-mesa/${roiId}`, { headers: authHeaders(token) });
}

export interface HistorialResponse {
  id: number;
  mesa_id: number;
  estado: string;
  created_at: string;
}

export interface ConteoPorEstadoResponse {
  libre: number;
  ocupada: number;
  pendiente_limpieza: number;
  reservada: number;
}

export interface OcupacionMetricaResponse {
  total_mesas: number;
  porcentaje_ocupacion: number;
  conteo_por_estado: ConteoPorEstadoResponse;
}

export async function obtenerOcupacion(
  request: APIRequestContext,
  token: string,
  params?: { sector_id?: number }
): Promise<OcupacionMetricaResponse> {
  const res = await request.get(`${BACKEND_URL}/metricas/ocupacion`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo obtener ocupación: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function listarHistorial(
  request: APIRequestContext,
  token: string,
  params?: { mesa_id?: number; fecha_inicio?: string; fecha_fin?: string; orden?: "asc" | "desc" }
): Promise<HistorialResponse[]> {
  const res = await request.get(`${BACKEND_URL}/historial/`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo listar historial: ${res.status()} ${await res.text()}`);
  return res.json();
}
