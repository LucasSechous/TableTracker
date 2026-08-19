// Guard de ruta admin-only (extraído de App.tsx: T26-128 lo introdujo para /calibracion-roi,
// esta es la segunda pantalla que lo usa — /camaras). No hay guard por rol reutilizable más
// genérico todavía (docs/roles-permisos.md lo marca como pendiente): las pantallas de admin
// que no usan este componente ocultan botones con esAdmin, pero no bloquean la ruta en sí.
// /camaras y /roi-mesa son admin-only en el backend (403 para cualquier otro rol), así que las
// pantallas que hablan con ellos necesitan este guard a nivel de ruta.
import { useEffect, useState, type JSX } from "react";
import { authApi } from "../services/api";

export default function AdminRoute({ children }: { children: JSX.Element }) {
  const [estado, setEstado] = useState<"cargando" | "admin" | "denegado">("cargando");

  useEffect(() => {
    authApi
      .me()
      .then((res) => setEstado(res.data.rol === "admin" ? "admin" : "denegado"))
      .catch(() => setEstado("denegado"));
  }, []);

  if (estado === "cargando") {
    return <p style={{ padding: 24, fontSize: 14, color: "#888" }}>Verificando permisos...</p>;
  }
  if (estado === "denegado") {
    return (
      <p style={{ padding: 24, fontSize: 14, color: "#c62828" }}>
        Esta pantalla es solo para administradores.
      </p>
    );
  }
  return children;
}
