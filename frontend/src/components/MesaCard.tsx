// Tarjeta visual que representa una mesa del salón en el panel principal.
// Muestra el estado con color, el sector, y permite cambiar el estado via PATCH al backend.
import { useState, useEffect, type ChangeEvent } from "react";
import type { AxiosError } from "axios";
import type { Mesa } from "../services/api";
import { mesasApi } from "../services/api";

const COLOR_POR_ESTADO: Record<string, string> = {
  libre: "#4caf50",
  ocupada: "#f44336",
  pendiente_limpieza: "#ff9800",
  reservada: "#2196f3",
};

interface Props {
  mesa: Mesa;
  onEstadoChange: (id: number, nuevoEstado: string) => void;
}

export default function MesaCard({ mesa, onEstadoChange }: Props) {
  const [estadoActual, setEstadoActual] = useState(mesa.estado);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    setEstadoActual(mesa.estado);
  }, [mesa.estado]);

  async function handleCambioEstado(e: ChangeEvent<HTMLSelectElement>) {
    const nuevoEstado = e.target.value;
    const estadoAnterior = estadoActual;
    setEstadoActual(nuevoEstado);
    setCambiando(true);
    try {
      await mesasApi.cambiarEstado(mesa.id, nuevoEstado);
      onEstadoChange(mesa.id, nuevoEstado);
    } catch (err) {
      setEstadoActual(estadoAnterior);
      const axiosErr = err as AxiosError<{ detail?: string }>;
      alert(axiosErr.response?.data?.detail ?? "Error al cambiar el estado");
    } finally {
      setCambiando(false);
    }
  }

  const color = COLOR_POR_ESTADO[estadoActual] ?? "#9e9e9e";
  const estadoTexto = estadoActual.replace(/_/g, " ").toUpperCase();

  return (
    <div
      style={{ backgroundColor: color }}
      className="rounded-xl p-4 text-white flex flex-col gap-2 w-40 shadow-md"
    >
      <span className="text-4xl font-bold leading-none">{mesa.numero}</span>
      <span className="text-sm opacity-90">{mesa.sector.nombre}</span>
      <span className="text-xs font-semibold tracking-wide">{estadoTexto}</span>
      <select
        value={estadoActual}
        disabled={cambiando}
        onChange={handleCambioEstado}
        className="mt-1 px-2 py-1 rounded-md text-xs text-gray-800 border-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none"
      >
        <option value="libre">Libre</option>
        <option value="ocupada">Ocupada</option>
        <option value="pendiente_limpieza">Pendiente de limpieza</option>
        <option value="reservada">Reservada</option>
      </select>
    </div>
  );
}
