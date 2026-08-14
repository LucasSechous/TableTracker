// Cliente HTTP centralizado para TableTracker.
// Instancia axios con interceptores JWT y manejo automático de sesión expirada.
import axios from "axios";
import type { AxiosError } from "axios";
import type { Mesa, Sector, HistorialEstado } from "../types";

export type { Mesa, Sector, HistorialEstado } from "../types";
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

export default api;
