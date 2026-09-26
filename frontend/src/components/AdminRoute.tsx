// Guard de ruta admin-only (extraído de App.tsx: T26-128 lo introdujo para /calibracion-roi,
// esta es la segunda pantalla que lo usa — /camaras).
// /camaras y /roi-mesa son admin-only en el backend (403 para cualquier otro rol), así que las
// pantallas que hablan con ellos necesitan este guard a nivel de ruta.
//
// El rol ya no se pide acá: sale de useAuth(), que resuelve /auth/me una sola vez para todo
// el árbol. Antes este componente hacía su propia llamada y DashboardPage otra, así que
// entrar al dashboard y de ahí a /camaras disparaba dos GET /auth/me idénticos.
//
// Bloquear la ruta y ocultar controles son cosas distintas y conviven: este guard tapa
// pantallas enteras que el backend rechaza completas, mientras que dentro del salón —donde
// conviven roles con permisos distintos— se ocultan controles sueltos con los helpers de
// permisos.ts. Ver docs/roles-permisos.md.
import { type JSX } from "react";
import { useAuth } from "../hooks/useAuth";
import { esAdmin } from "../permisos";

export default function AdminRoute({ children }: { children: JSX.Element }) {
  const { rol, loading } = useAuth();

  if (loading) {
    return <p style={{ padding: 24, fontSize: 14, color: "#888" }}>Verificando permisos...</p>;
  }
  if (!esAdmin(rol)) {
    return (
      <p style={{ padding: 24, fontSize: 14, color: "#c62828" }}>
        Esta pantalla es solo para administradores.
      </p>
    );
  }
  return children;
}
