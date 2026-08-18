// Punto de entrada de la aplicación TableTracker.
// Define el enrutamiento principal con React Router y protege las rutas autenticadas.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, type JSX } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import HistorialPage from "./pages/HistorialPage";
import CalibracionRoiPage from "./pages/CalibracionRoiPage";
import { authApi } from "./services/api";

function PrivateRoute({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
}

// No hay guard por rol reutilizable todavía (docs/roles-permisos.md lo marca como
// pendiente): las pantallas de admin existentes ocultan botones con esAdmin, pero no
// bloquean la ruta en sí. /camaras y /roi-mesa son admin-only en el backend (403 para
// cualquier otro rol), así que esta pantalla necesita su propio guard a nivel de ruta.
function AdminRoute({ children }: { children: JSX.Element }) {
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/historial"
          element={
            <PrivateRoute>
              <HistorialPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/calibracion-roi"
          element={
            <PrivateRoute>
              <AdminRoute>
                <CalibracionRoiPage />
              </AdminRoute>
            </PrivateRoute>
          }
        />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <DashboardPage />
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
