// Usuario autenticado, resuelto una sola vez para todo el árbol.
//
// Antes cada consumidor pedía GET /auth/me por su cuenta: AdminRoute uno y DashboardPage
// otro, así que entrar a /camaras disparaba dos llamadas idénticas, y cada componente
// nuevo que necesitara el rol sumaba una más. `docs/roles-permisos.md` dejaba anotado como
// pendiente que no hubiera un guard por rol reutilizable; esto es esa pieza.
//
// Vive en hooks/ y no en un context/ propio porque la API pública de este módulo es
// useAuth(): AuthProvider es el andamio que la sostiene, no algo que se consuma suelto.
//
// El provider va DENTRO de <BrowserRouter> a propósito (ver App.tsx). El token se lee en
// cada render y no una sola vez al montar, y de eso depende que login y logout funcionen:
// LoginPage guarda el token y hace navigate("/"), esa navegación re-renderiza el árbol
// bajo el router, acá se ve el token nuevo y el efecto vuelve a pedir /auth/me. En el
// logout pasa lo simétrico — se borra el token, se navega, y el estado queda en null.
//
// Sin token NO se llama a /auth/me, y eso no es una optimización: el interceptor de axios
// manda a /login ante cualquier 401 que no venga de /auth/login (services/api.ts). Si el
// provider pidiera /auth/me estando en la pantalla de login, el 401 dispararía una
// redirección a /login, que remonta, que vuelve a pedir: un bucle de recargas.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/api";
import type { UserResponse } from "../services/api";

interface AuthState {
  /** Usuario autenticado, o null si no hay sesión (o todavía no se resolvió). */
  user: UserResponse | null;
  /** Atajo de user?.rol. `undefined` mientras carga: los helpers de permisos.ts devuelven false ante eso. */
  rol: string | undefined;
  /** true mientras se está resolviendo /auth/me. Nunca queda colgado: el catch también lo apaga. */
  loading: boolean;
}

const SIN_SESION: AuthState = { user: null, rol: undefined, loading: false };

// undefined como default para poder distinguir "no hay provider" de "hay provider y no hay
// sesión", y fallar fuerte en el primer caso en vez de devolver un rol vacío que haría que
// todos los controles se escondan sin explicación.
const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const token = localStorage.getItem("token");
  // navigate va en un ref y no en las dependencias del efecto: si su identidad cambiara en
  // alguna navegación, el efecto volvería a pedir /auth/me y se perdería justamente lo que
  // este provider vino a resolver — que se pida una sola vez.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [estado, setEstado] = useState<AuthState>(() =>
    token ? { user: null, rol: undefined, loading: true } : SIN_SESION
  );

  useEffect(() => {
    if (!token) {
      setEstado(SIN_SESION);
      return;
    }

    // Misma disciplina de cancelación que useObjectUrl/useDeteccionActual: si el token
    // cambia o el provider se desmonta antes de que llegue la respuesta, no se hace
    // setState sobre un árbol que ya no está.
    let cancelado = false;
    setEstado({ user: null, rol: undefined, loading: true });

    authApi
      .me()
      .then((res) => {
        if (!cancelado) setEstado({ user: res.data, rol: res.data.rol, loading: false });
      })
      .catch(() => {
        // Cualquier fallo termina en "no hay sesión" y no en loading eterno, que dejaría
        // la pantalla clavada en "Verificando permisos...".
        if (cancelado) return;
        setEstado(SIN_SESION);
        // Había un token y aun así no se pudo resolver la sesión: backend caído, red, o un
        // token que ya no sirve. Se va a /login en vez de quedarse en una pantalla sin
        // usuario. Esto lo hacía antes el catch del authApi.me() de DashboardPage y la
        // suite lo fija como comportamiento esperado (e2e 1.4).
        //
        // No alcanza con el interceptor de axios: ese solo reacciona a un 401 *con
        // respuesta*, y un backend caído da un error de red, donde `error.response` es
        // undefined y la redirección nunca se dispara.
        navigateRef.current("/login");
      });

    return () => {
      cancelado = true;
    };
  }, [token]);

  return <AuthContext.Provider value={estado}>{children}</AuthContext.Provider>;
}

/**
 * Usuario autenticado y su rol, sin pedirlos de nuevo.
 *
 * Para decidir si mostrar un control, cruzar `rol` con los helpers de `permisos.ts`
 * (puedeEditarLayout, puedeBorrar) en vez de comparar strings acá y allá.
 */
export function useAuth(): AuthState {
  const contexto = useContext(AuthContext);
  if (contexto === undefined) {
    throw new Error("useAuth() tiene que usarse dentro de <AuthProvider> (ver App.tsx)");
  }
  return contexto;
}
