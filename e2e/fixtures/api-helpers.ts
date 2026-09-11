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

/**
 * Roles no-admin que la suite necesita para probar el gateo de la UI (RF-02).
 *
 * Arrancó con `encargado` y `mozo`, los dos que cambian algo en el modo edición (T26-194).
 * T26-195 sumó `recepcion` y `limpieza`: en el panel de mesa los permisos son cruzados y
 * cada uno de los cuatro ve una combinación distinta de controles, así que ahí sí aportan
 * un caso propio.
 */
export type RolDePrueba = "encargado" | "mozo" | "recepcion" | "limpieza";

/**
 * Credenciales derivadas del usuario de e2e, una por rol.
 *
 * Se usa el alias `+rol` del email del runner (que EmailStr acepta) en vez de un email
 * suelto: deja claro de dónde salen y las mantiene deterministas entre corridas. Eso
 * último importa porque **no hay endpoint para borrar usuarios** (docs/roles-permisos.md),
 * así que un email aleatorio por corrida iría dejando cuentas muertas en la base para
 * siempre. Con este esquema son dos, se crean una vez y se reutilizan.
 */
export function credencialesDeRol(rol: RolDePrueba) {
  const [local, dominio] = TEST_USER.email.split("@");
  return {
    nombre: `E2E ${rol}`,
    email: `${local}+${rol}@${dominio}`,
    password: TEST_USER.password,
    rol,
  };
}

/**
 * Devuelve un token para un usuario con ese rol, creándolo si es la primera vez.
 *
 * Idempotente: POST /auth/register contesta 400 "El email ya está registrado" si ya
 * existe, y eso no es un fallo sino el camino normal a partir de la segunda corrida.
 * Necesita un token de admin porque el registro es admin-only desde T26-116.
 */
export async function ensureUsuarioDeRol(
  request: APIRequestContext,
  tokenAdmin: string,
  rol: RolDePrueba
): Promise<string> {
  const credenciales = credencialesDeRol(rol);
  const res = await request.post(`${BACKEND_URL}/auth/register`, {
    headers: authHeaders(tokenAdmin),
    data: credenciales,
  });
  if (!res.ok() && res.status() !== 400) {
    throw new Error(
      `No se pudo asegurar el usuario de rol "${rol}" (${res.status()}): ${await res.text()}`
    );
  }
  return loginViaApi(request, credenciales.email, credenciales.password);
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
/**
 * Da de alta un ROI para una mesa en una cámara (T26-188).
 *
 * Solo admin. Las coordenadas son un polígono en píxeles del frame; el contenido no importa
 * para los tests que solo necesitan que la mesa tenga cobertura de detección, pero el
 * backend exige un polígono válido, así que va un triángulo mínimo.
 */
export async function crearRoi(
  request: APIRequestContext,
  token: string,
  datos: { mesa_id: number; camara_id: number; coordenadas?: number[][] }
): Promise<RoiMesaResponse> {
  const res = await request.post(`${BACKEND_URL}/roi-mesa/`, {
    headers: authHeaders(token),
    data: { coordenadas: [[0, 0], [40, 0], [40, 40]], ...datos },
  });
  if (!res.ok()) throw new Error(`No se pudo crear el ROI: ${res.status()} ${await res.text()}`);
  return res.json();
}

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
  // Alerta de alta ocupación (T26-187, RF-26). La comparación la resuelve el backend.
  umbral_ocupacion_alta: number;
  ocupacion_alta: boolean;
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

export interface ConfiguracionResponse {
  ancho_salon: number;
  alto_salon: number;
  nombre_establecimiento: string | null;
  cantidad_mesas_referencia: number | null;
  // Horario de servicio (T26-171) y umbral de limpieza demorada (T26-173). null = apagado.
  hora_apertura: string | null;
  hora_cierre: string | null;
  minutos_limpieza_demorada: number | null;
  // Umbrales de detección de vision-module (T26-183). Nunca null: NOT NULL con default.
  confirmacion_segundos: number;
  overlap_minimo: number;
  // Umbral de alta ocupación en % (T26-187). Tampoco es null nunca: NOT NULL con default 85.
  umbral_ocupacion_alta: number;
  // Solo presentes cuando el PATCH cambió el umbral correspondiente.
  confirmacion_segundos_anterior?: number | null;
  overlap_minimo_anterior?: number | null;
}

export async function obtenerConfiguracion(
  request: APIRequestContext,
  token: string
): Promise<ConfiguracionResponse> {
  const res = await request.get(`${BACKEND_URL}/configuracion`, { headers: authHeaders(token) });
  if (!res.ok()) throw new Error(`No se pudo obtener configuración: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function actualizarConfiguracion(
  request: APIRequestContext,
  token: string,
  datos: {
    ancho_salon?: number;
    alto_salon?: number;
    nombre_establecimiento?: string;
    cantidad_mesas_referencia?: number;
    hora_apertura?: string;
    hora_cierre?: string;
    minutos_limpieza_demorada?: number;
    confirmacion_segundos?: number;
    overlap_minimo?: number;
    umbral_ocupacion_alta?: number;
  }
): Promise<ConfiguracionResponse> {
  const res = await request.patch(`${BACKEND_URL}/configuracion`, { headers: authHeaders(token), data: datos });
  if (!res.ok()) throw new Error(`No se pudo actualizar configuración: ${res.status()} ${await res.text()}`);
  return res.json();
}

export interface RotacionMesaResponse {
  mesa_id: number;
  numero: number;
  sector_id: number;
  rotaciones: number;
}

export async function obtenerRotacion(
  request: APIRequestContext,
  token: string,
  params?: { fecha_inicio?: string; fecha_fin?: string; sector_id?: number }
): Promise<RotacionMesaResponse[]> {
  const res = await request.get(`${BACKEND_URL}/metricas/rotacion`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo obtener rotación: ${res.status()} ${await res.text()}`);
  return res.json();
}

export interface TiempoPorEstadoResponse {
  libre: number;
  ocupada: number;
  pendiente_limpieza: number;
  reservada: number;
}

export interface OcupacionDiariaMesaResponse {
  mesa_id: number;
  numero: number;
  sector_id: number;
  minutos_por_estado: TiempoPorEstadoResponse;
  porcentaje_ocupacion: number;
}

export interface OcupacionDiariaResponse {
  fecha: string;
  inicio: string;
  fin: string;
  total_mesas: number;
  porcentaje_ocupacion: number;
  minutos_por_estado: TiempoPorEstadoResponse;
  mesas: OcupacionDiariaMesaResponse[];
}

export async function obtenerOcupacionDiaria(
  request: APIRequestContext,
  token: string,
  params?: { fecha?: string; sector_id?: number }
): Promise<OcupacionDiariaResponse> {
  const res = await request.get(`${BACKEND_URL}/metricas/ocupacion-diaria`, { headers: authHeaders(token), params });
  if (!res.ok()) throw new Error(`No se pudo obtener ocupación diaria: ${res.status()} ${await res.text()}`);
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
