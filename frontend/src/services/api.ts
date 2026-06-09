const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail ?? "Error desconocido");
  }
  return res.json();
}

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
    request<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (nombre: string, email: string, password: string, rol = "mozo") =>
    request<UserResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ nombre, email, password, rol }),
    }),

  me: (token: string) =>
    request<UserResponse>("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }),
};
