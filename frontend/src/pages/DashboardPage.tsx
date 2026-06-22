import { useEffect, useState } from "react";
import { authApi } from "../services/api";
import type { UserResponse } from "../services/api";


interface Props {
  token: string;
  onLogout: () => void;
}

export default function DashboardPage({ token, onLogout }: Props) {
  const [user, setUser] = useState<UserResponse | null>(null);

  useEffect(() => {
    authApi.me(token).then(setUser).catch(() => onLogout());
  }, [token, onLogout]);

  function handleLogout() {
    localStorage.removeItem("token");
    onLogout();
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-800">TableTracker</h1>
        <div className="flex items-center gap-4">
          {user && (
            <span className="text-sm text-gray-600">
              {user.nombre} · <span className="capitalize">{user.rol}</span>
            </span>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-red-600 hover:underline"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="p-6">
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            Panel de mesas
          </h2>
          <p className="text-sm text-gray-400">
            Próximamente: mapa del salón con estado de mesas en tiempo real.
          </p>
        </div>
      </main>
    </div>
  );
}
