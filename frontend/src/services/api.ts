// Cliente HTTP centralizado para TableTracker.
// Instancia axios con interceptores JWT y manejo automático de sesión expirada.
import axios from "axios";
import type { AxiosError } from "axios";
import type { Mesa, Sector } from "../types";

export type { Mesa, Sector } from "../types";
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

  cambiarEstado: (id: number, estado: string) =>
    api.patch<Mesa>(`/mesas/${id}/estado`, { estado }),

  cambiarPosicion: (id: number, pos_x: number, pos_y: number) =>
    api.patch<Mesa>(`/mesas/${id}/posicion`, { pos_x, pos_y }),
};

export const sectoresApi = {
  listar: () => api.get<Sector[]>("/sectores"),

  actualizar: (
    id: number,
    datos: { pos_x?: number; pos_y?: number; nombre?: string; ancho?: number; alto?: number }
  ) => api.patch<Sector>(`/sectores/${id}`, datos),
};

export default api;
