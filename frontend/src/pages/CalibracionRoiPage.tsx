// Pantalla de calibración de ROI (T26-128 v1): elegís una cámara y una mesa, pedís un frame
// de referencia y dibujás el polígono de la zona sobre la imagen. Editar una zona ya guardada
// (arrastrar/borrar vértice) es T26-144, un ticket aparte — acá solo se crea de punta a punta.
// Acceso restringido a admin (ver AdminRoute en App.tsx), igual que /camaras y /roi-mesa en
// el backend (requiere_rol("admin")).

import { useEffect, useState } from "react";
import type { AxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { camarasApi, mesasApi, roiMesaApi, extraerDetalleApi } from "../services/api";
import type { Camara, Mesa, RoiMesa, PuntoRoi } from "../types";
import { useObjectUrl } from "../hooks/useObjectUrl";
import RoiCanvas from "../components/RoiCanvas";

const TIMEOUT_SNAPSHOT_SEGUNDOS = 5;

const estiloBoton: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid #1976d2",
  fontSize: 13,
  cursor: "pointer",
  backgroundColor: "#fff",
  color: "#1976d2",
  fontWeight: 500,
};

const estiloBotonPrimario: React.CSSProperties = {
  ...estiloBoton,
  border: "none",
  backgroundColor: "#1976d2",
  color: "#fff",
};

const estiloSelect: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid #ccc",
  borderRadius: 6,
  backgroundColor: "#fff",
};

const estiloError: React.CSSProperties = {
  fontSize: 13,
  color: "#c62828",
  backgroundColor: "#ffebee",
  border: "1px solid #ef9a9a",
  borderRadius: 6,
  padding: "8px 12px",
};

const estiloExito: React.CSSProperties = {
  fontSize: 13,
  color: "#2e7d32",
  backgroundColor: "#e8f5e9",
  border: "1px solid #a5d6a7",
  borderRadius: 6,
  padding: "8px 12px",
};

export default function CalibracionRoiPage() {
  const navigate = useNavigate();

  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [errorInicial, setErrorInicial] = useState<string | null>(null);

  const [camaraId, setCamaraId] = useState<number | "">("");
  const [mesaId, setMesaId] = useState<number | "">("");

  const [rois, setRois] = useState<RoiMesa[]>([]);
  const [errorRois, setErrorRois] = useState<string | null>(null);

  const [snapshotToken, setSnapshotToken] = useState(0);
  const [draftPoints, setDraftPoints] = useState<PuntoRoi[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([camarasApi.listar(), mesasApi.listar()])
      .then(([camarasRes, mesasRes]) => {
        setCamaras(camarasRes.data);
        setMesas(mesasRes.data);
      })
      .catch(async (err: unknown) => {
        setErrorInicial(await extraerDetalleApi(err, "No se pudieron cargar cámaras y mesas"));
      })
      .finally(() => setCargandoInicial(false));
  }, []);

  const camaraSeleccionada = camaras.find((c) => c.id === camaraId) ?? null;
  // Filtro simple en memoria (ya se tienen todas las mesas con su sector embebido): no hace
  // falta un fetch extra. No es una regla dura del backend, solo acota la lista por comodidad.
  const mesasFiltradas = camaraSeleccionada
    ? mesas.filter((m) => m.sector.id === camaraSeleccionada.sector_id)
    : mesas;

  async function cargarRois(id: number) {
    try {
      const { data } = await roiMesaApi.listar({ camara_id: id });
      setRois(data);
      setErrorRois(null);
    } catch (err) {
      setErrorRois(await extraerDetalleApi(err, "No se pudieron cargar los ROI existentes de esta cámara"));
    }
  }

  function handleCamaraChange(valor: string) {
    const id = valor === "" ? "" : Number(valor);
    setCamaraId(id);
    setMesaId("");
    setDraftPoints([]);
    setSnapshotToken(0);
    setErrorGuardado(null);
    setExito(null);
    setRois([]);
    setErrorRois(null);
    if (id !== "") cargarRois(id);
  }

  function handleMesaChange(valor: string) {
    setMesaId(valor === "" ? "" : Number(valor));
    setDraftPoints([]);
    setErrorGuardado(null);
    setExito(null);
  }

  async function pedirSnapshotBlob(id: number): Promise<Blob> {
    try {
      const { data } = await camarasApi.snapshot(id, TIMEOUT_SNAPSHOT_SEGUNDOS);
      return data;
    } catch (err) {
      throw new Error(await extraerDetalleApi(err, "No se pudo obtener el frame de la cámara"));
    }
  }

  const {
    src: snapshotSrc,
    error: snapshotError,
    loading: snapshotLoading,
  } = useObjectUrl(
    camaraId !== "" && snapshotToken > 0 ? () => pedirSnapshotBlob(camaraId) : null,
    [camaraId, snapshotToken]
  );

  // Los ROI ya guardados de la MISMA mesa no deberían existir en paralelo con un draft nuevo
  // (crear otro para el mismo par mesa+cámara da 409, ver handleFinalizar), pero de todos
  // modos se excluyen del overlay de "solo lectura": lo que importa mostrar ahí son las
  // zonas de las demás mesas, no la que se está por definir.
  const roisDeOtrasMesas = rois.filter((r) => r.mesa_id !== mesaId);

  function handleReiniciar() {
    setDraftPoints([]);
    setErrorGuardado(null);
    setExito(null);
  }

  async function handleFinalizar() {
    if (camaraId === "" || mesaId === "" || draftPoints.length < 3) return;
    setGuardando(true);
    setErrorGuardado(null);
    setExito(null);
    try {
      await roiMesaApi.crear({ mesa_id: mesaId, camara_id: camaraId, coordenadas: draftPoints });
      const mesa = mesas.find((m) => m.id === mesaId);
      setExito(`Zona guardada para la mesa ${mesa?.numero ?? mesaId}. Elegí otra mesa para seguir calibrando.`);
      setDraftPoints([]);
      setMesaId("");
      await cargarRois(camaraId);
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 409) {
        setErrorGuardado(
          "Ya existe una zona activa para esta mesa en esta cámara. Todavía no se puede editar una zona existente desde acá."
        );
      } else {
        setErrorGuardado(await extraerDetalleApi(err, "No se pudo guardar la zona"));
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <header
        style={{
          backgroundColor: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
          Calibración de ROI
        </h1>
        <button onClick={() => navigate("/")} style={estiloBoton}>
          Volver al salón
        </button>
      </header>

      <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        {cargandoInicial && <p style={{ fontSize: 14, color: "#888" }}>Cargando cámaras y mesas...</p>}
        {errorInicial && <p style={estiloError}>{errorInicial}</p>}

        {!cargandoInicial && !errorInicial && (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 13, color: "#555", display: "flex", flexDirection: "column", gap: 4 }}>
                Cámara
                <select
                  value={camaraId}
                  onChange={(e) => handleCamaraChange(e.target.value)}
                  style={estiloSelect}
                >
                  <option value="">Elegí una cámara...</option>
                  {camaras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>

              {camaraId !== "" && (
                <label style={{ fontSize: 13, color: "#555", display: "flex", flexDirection: "column", gap: 4 }}>
                  Mesa
                  <select
                    value={mesaId}
                    onChange={(e) => handleMesaChange(e.target.value)}
                    style={estiloSelect}
                  >
                    <option value="">Elegí una mesa...</option>
                    {mesasFiltradas.map((m) => (
                      <option key={m.id} value={m.id}>
                        Mesa {m.numero} ({m.sector.nombre})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {camaraId !== "" && (
                <button
                  onClick={() => setSnapshotToken((n) => n + 1)}
                  disabled={snapshotLoading}
                  style={{ ...estiloBoton, opacity: snapshotLoading ? 0.6 : 1, alignSelf: "flex-end" }}
                >
                  {snapshotLoading ? "Cargando frame..." : "Actualizar frame"}
                </button>
              )}
            </div>

            {camaras.length === 0 && (
              <p style={{ fontSize: 13, color: "#666" }}>No hay cámaras activas dadas de alta todavía.</p>
            )}

            {errorRois && <p style={estiloError}>{errorRois}</p>}

            {camaraId !== "" && mesaId === "" && (
              <p style={{ fontSize: 13, color: "#666" }}>Elegí una mesa para poder dibujar su zona.</p>
            )}

            {camaraId !== "" && snapshotToken === 0 && !snapshotLoading && (
              <p style={{ fontSize: 13, color: "#666" }}>
                Apretá "Actualizar frame" para traer una imagen actual de la cámara.
              </p>
            )}

            {snapshotError && (
              <p style={estiloError}>{snapshotError} — probá "Actualizar frame" de nuevo.</p>
            )}

            {snapshotSrc && mesaId !== "" && (
              <>
                <RoiCanvas
                  snapshotSrc={snapshotSrc}
                  roisExistentes={roisDeOtrasMesas}
                  draftPoints={draftPoints}
                  mesaSeleccionadaNumero={mesas.find((m) => m.id === mesaId)?.numero}
                  onAddPoint={(punto) => setDraftPoints((prev) => [...prev, punto])}
                />

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 13, color: "#555" }}>
                    {draftPoints.length} punto{draftPoints.length === 1 ? "" : "s"} (mínimo 3)
                  </span>
                  <button onClick={handleReiniciar} disabled={draftPoints.length === 0 || guardando} style={estiloBoton}>
                    Reiniciar
                  </button>
                  <button
                    onClick={handleFinalizar}
                    disabled={draftPoints.length < 3 || guardando}
                    style={{
                      ...estiloBotonPrimario,
                      opacity: draftPoints.length < 3 || guardando ? 0.5 : 1,
                      cursor: draftPoints.length < 3 || guardando ? "default" : "pointer",
                    }}
                  >
                    {guardando ? "Guardando..." : "Finalizar zona"}
                  </button>
                </div>
              </>
            )}

            {errorGuardado && <p style={estiloError}>{errorGuardado}</p>}
            {exito && <p style={estiloExito}>{exito}</p>}
          </>
        )}
      </main>
    </div>
  );
}
