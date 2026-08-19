// Punto de entrada de la aplicación TableTracker.
// Define el enrutamiento principal con React Router y protege las rutas autenticadas.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { type JSX } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import HistorialPage from "./pages/HistorialPage";
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
