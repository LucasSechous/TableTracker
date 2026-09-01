// Punto de entrada de la aplicación TableTracker.
// Define el enrutamiento principal con React Router y protege las rutas autenticadas.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { type JSX } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import HistorialPage from "./pages/HistorialPage";
import OcupacionPage from "./pages/OcupacionPage";
import RotacionPage from "./pages/RotacionPage";
import ConfiguracionPage from "./pages/ConfiguracionPage";
import CalibracionRoiPage from "./pages/CalibracionRoiPage";
import CamarasPage from "./pages/CamarasPage";
import AdminRoute from "./components/AdminRoute";

function PrivateRoute({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
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
        {/* Sin AdminRoute a propósito: el panel de ocupación lo consultan todos los roles
            (mozo incluido), igual que GET /metricas/ocupacion, que pide sesión pero no rol. */}
        <Route
          path="/ocupacion"
          element={
            <PrivateRoute>
              <OcupacionPage />
            </PrivateRoute>
          }
        />
        {/* Sin AdminRoute por el mismo motivo que /ocupacion: GET /metricas/rotacion
            pide sesión pero no rol. */}
        <Route
          path="/rotacion"
          element={
            <PrivateRoute>
              <RotacionPage />
            </PrivateRoute>
          }
        />
        {/* Con AdminRoute, a diferencia de /ocupacion y /rotacion: el PATCH /configuracion
            exige rol admin, así que dejar entrar a un mozo sería mostrarle un formulario
            que va a fallar con 403 recién al guardar. */}
        <Route
          path="/configuracion"
          element={
            <PrivateRoute>
              <AdminRoute>
                <ConfiguracionPage />
              </AdminRoute>
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
          path="/camaras"
          element={
            <PrivateRoute>
              <AdminRoute>
                <CamarasPage />
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
