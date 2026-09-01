// Cliente HTTP centralizado para TableTracker.
// Instancia axios con interceptores JWT y manejo automático de sesión expirada.
import axios from "axios";
import type { AxiosError } from "axios";
import type {
  Mesa,
  Sector,
  HistorialEstado,
  Configuracion,
  Camara,
  RoiMesa,
  PuntoRoi,
  CamaraTestResponse,
  DetectionFrameResult,
  OcupacionResponse,
  RotacionMesa,
} from "../types";

export type {
  Mesa,
  Sector,
  HistorialEstado,
  Configuracion,
  Camara,
  RoiMesa,
  PuntoRoi,
  CamaraTestResponse,
  DetectionFrameResult,
  ConteoPorEstado,
  OcupacionResponse,
  RotacionMesa,
} from "../types";
export type { Modo } from "../types";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Endpoints públicos de auth: un 401 acá significa "credenciales inválidas",
// nunca "sesión expirada", así que no deben disparar el logout global.
const PUBLIC_AUTH_PATHS = ["/auth/login", "/auth/register"];

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isPublicAuthRequest = PUBLIC_AUTH_PATHS.some((path) => error.config?.url?.includes(path));
    if (error.response?.status === 401 && !isPublicAuthRequest) {
      localStorage.clear();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface UserResponse {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<TokenResponse>("/auth/login", { email, password }),

  me: () => api.get<UserResponse>("/auth/me"),
};

export const mesasApi = {
  listar: (params?: { estado?: string; sector_id?: number }) =>
    api.get<Mesa[]>("/mesas", { params }),

  // La barra final apunta al path exacto del router y evita el 307 de FastAPI,
  // que en un POST obliga a repetir preflight y cuerpo.
  crear: (datos: { numero: number; sector_id: number; estado?: string; activa?: boolean }) =>
    api.post<Mesa>("/mesas/", datos),

  cambiarEstado: (id: number, estado: string) =>
    api.patch<Mesa>(`/mesas/${id}/estado`, { estado }),

  cambiarPosicion: (id: number, pos_x: number, pos_y: number) =>
    api.patch<Mesa>(`/mesas/${id}/posicion`, { pos_x, pos_y }),

  confirmarLimpieza: (id: number) => api.patch<Mesa>(`/mesas/${id}/limpieza`),

  marcarReservada: (id: number) => api.patch<Mesa>(`/mesas/${id}/reserva`),

  // Soft-delete vía el PATCH genérico (mismo endpoint que usa MesaUpdate.activa en el
  // backend), igual que sectoresApi.actualizar(id, { activo: false }). No usa el
  // DELETE /mesas/{id} (hard-delete, solo admin, falla con 409 si hay historial).
  desactivar: (id: number) => api.patch<Mesa>(`/mesas/${id}`, { activa: false }),
};

export const historialApi = {
  listar: (params?: { mesa_id?: number; fecha_inicio?: string; fecha_fin?: string; orden?: "asc" | "desc" }) =>
    api.get<HistorialEstado[]>("/historial/", { params }),
};

export const sectoresApi = {
  listar: () => api.get<Sector[]>("/sectores"),

  crear: (datos: { nombre: string; descripcion?: string; activo?: boolean }) =>
    api.post<Sector>("/sectores/", datos),

  actualizar: (
    id: number,
    datos: {
      pos_x?: number
      pos_y?: number
      nombre?: string
      descripcion?: string
      ancho?: number
      alto?: number
      activo?: boolean
    }
  ) => api.patch<Sector>(`/sectores/${id}`, datos),

  eliminar: (id: number) => api.delete(`/sectores/${id}`),
};

export const configuracionApi = {
  obtener: () => api.get<Configuracion>("/configuracion"),

  actualizar: (datos: { ancho_salon?: number; alto_salon?: number; nombre_establecimiento?: string }) =>
    api.patch<Configuracion>("/configuracion", datos),
};

export const camarasApi = {
  listar: (params?: { sector_id?: number; incluir_inactivas?: boolean }) =>
    api.get<Camara[]>("/camaras/", { params }),

  obtener: (id: number) => api.get<Camara>(`/camaras/${id}`),

  // La barra final apunta al path exacto del router y evita el 307 de FastAPI (ver mesasApi.crear).
  crear: (datos: { nombre: string; rtsp_url: string; sector_id: number; activa?: boolean }) =>
    api.post<Camara>("/camaras/", datos),

  actualizar: (
    id: number,
    datos: { nombre?: string; rtsp_url?: string; sector_id?: number; activa?: boolean }
  ) => api.patch<Camara>(`/camaras/${id}`, datos),

  // Baja lógica: el backend deja activa=false, no borra la fila (ver camaras.py).
  desactivar: (id: number) => api.delete(`/camaras/${id}`),

  // Sin body: el backend recibe el timeout por query param, no por el cuerpo del POST.
  testConexion: (id: number, timeoutSegundos?: number) =>
    api.post<CamaraTestResponse>(`/camaras/${id}/test-conexion`, undefined, {
      params: { timeout_segundos: timeoutSegundos },
    }),

  // responseType "blob": el endpoint devuelve JPEG crudo, no JSON. Un frame único de la
  // cámara para calibrar sobre él, no un stream — no hay refresh automático (T26-134).
  snapshot: (id: number, timeoutSegundos = 5) =>
    api.get<Blob>(`/camaras/${id}/snapshot`, {
      params: { timeout_segundos: timeoutSegundos },
      responseType: "blob",
    }),

  // Último resultado de detección publicado por vision-module para esta cámara
  // (T26-150). 404 si todavía no llegó ninguno: no es un error de red, lo trata
  // así useDeteccionActual, no este cliente.
  deteccionActual: (id: number) => api.get<DetectionFrameResult>(`/camaras/${id}/deteccion-actual`),
};

export const roiMesaApi = {
  listar: (params?: { mesa_id?: number; camara_id?: number; incluir_inactivos?: boolean }) =>
    api.get<RoiMesa[]>("/roi-mesa/", { params }),

  crear: (datos: { mesa_id: number; camara_id: number; coordenadas: PuntoRoi[] }) =>
    api.post<RoiMesa>("/roi-mesa/", datos),

  actualizar: (id: number, datos: { coordenadas?: PuntoRoi[]; activa?: boolean }) =>
    api.patch<RoiMesa>(`/roi-mesa/${id}`, datos),

  // Baja lógica: el backend deja activa=false, no borra la fila (ver roi.py).
  eliminar: (id: number) => api.delete(`/roi-mesa/${id}`),
};

export const metricasApi = {
  // Agregado calculado en el momento sobre mesas activas, no un recurso persistido:
  // cada llamada devuelve la foto actual del salón (T26-158, RF-22). El endpoint acepta
  // un sector_id opcional que esta UI todavía no expone (fuera del alcance del ticket).
  ocupacion: () => api.get<OcupacionResponse>("/metricas/ocupacion"),

  // Rotaciones por mesa en un rango (T26-159, RF-23). Sin fechas devuelve el histórico
  // completo. fecha_inicio/fecha_fin son datetimes ISO, no fechas sueltas: para que el
  // "hasta" sea inclusivo hay que mandar el fin del día (ver finDelDia en RangoFechas).
  rotacion: (params?: { fecha_inicio?: string; fecha_fin?: string; sector_id?: number }) =>
    api.get<RotacionMesa[]>("/metricas/rotacion", { params }),
};

// Con responseType "blob" (ver camarasApi.snapshot), un error HTTP no trae el detail como
// JSON directo: axios ya devolvió el cuerpo como Blob antes de que se supiera que el status
// no era 2xx. Hay que leerlo como texto y parsearlo a mano. Para el resto de los endpoints
// (JSON normal) el detail ya viene parseado en response.data, así que esta misma función
// sirve para cualquier error de la API sin que el que llama tenga que distinguir el caso.
export async function extraerDetalleApi(err: unknown, fallback: string): Promise<string> {
  const axiosErr = err as AxiosError;
  const data = axiosErr.response?.data;

  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.detail === "string") return parsed.detail;
    } catch {
      // Cuerpo no era JSON (o no se pudo leer): se usa el fallback.
    }
    return fallback;
  }

  const detail = (data as { detail?: string } | undefined)?.detail;
  return typeof detail === "string" ? detail : fallback;
}

export default api;
