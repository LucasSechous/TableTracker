import type { APIRequestContext } from "@playwright/test";
import { BACKEND_URL } from "../playwright.config";

export const TEST_USER = {
  nombre: "E2E Test Runner",
  email: "e2e.tabletracker@tabletracker-e2e.dev",
  password: "E2eTest!2026",
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

/** Registra el usuario fijo de e2e si todavía no existe (idempotente). */
export async function ensureTestUser(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND_URL}/auth/register`, { data: TEST_USER });
  if (res.ok()) return;
  const body = await res.json().catch(() => ({}));
  if (res.status() === 400 && String(body.detail ?? "").includes("ya está registrado")) return;
  throw new Error(`No se pudo asegurar el usuario de test: ${res.status()} ${JSON.stringify(body)}`);
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

export async function listarMesas(
  request: APIRequestContext,
  token: string,
  params?: { sector_id?: number }
): Promise<MesaResponse[]> {
  const res = await request.get(`${BACKEND_URL}/mesas/`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo listar mesas: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function listarSectores(request: APIRequestContext, token: string): Promise<SectorResponse[]> {
  const res = await request.get(`${BACKEND_URL}/sectores/`, { headers: authHeaders(token) });
  if (!res.ok()) throw new Error(`No se pudo listar sectores: ${res.status()} ${await res.text()}`);
  return res.json();
}

/** Sufijo único por corrida/worker para no colisionar nombres/números contra datos reales o entre workers. */
export function uniqueSuffix(workerIndex: number): string {
  return `${Date.now()}_${workerIndex}`;
}
