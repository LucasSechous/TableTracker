import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";

export default function App() {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem("token")
  );

  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  return <DashboardPage token={token} onLogout={() => setToken(null)} />;
}
