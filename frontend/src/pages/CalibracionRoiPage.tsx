// Pantalla de calibración de ROI: elegís una cámara y una mesa, pedís un frame de referencia
// y dibujás el polígono de la zona sobre la imagen (T26-128). Si la mesa elegida ya tiene un
// ROI activo en esa cámara, en vez de arrancar un dibujo nuevo (que terminaría en 409) se
// carga ese polígono en modo edición: arrastrar/borrar vértice, guardar cambios o eliminar la
// zona completa (T26-144). Acceso restringido a admin (ver AdminRoute en App.tsx), igual que
// /camaras y /roi-mesa en el backend (requiere_rol("admin")).
//
// El toggle "detecciones en vivo" (T26-150) superpone lo último que publicó vision-module
// para la cámara elegida. Depende solo de cámara + snapshot cargados, no de tener una mesa
// seleccionada: a diferencia del ROI, las detecciones son por cámara, no por mesa.

import { useEffect, useRef, useState } from "react";
import type { AxiosError } from "axios";
import Layout from "../components/Layout";
import Boton from "../components/ui/Boton";
import { camarasApi, mesasApi, roiMesaApi, extraerDetalle } from "../services/api";
import type { Camara, Mesa, RoiMesa, PuntoRoi } from "../types";
import { useObjectUrl } from "../hooks/useObjectUrl";
import { useDeteccionActual } from "../hooks/useDeteccionActual";
import RoiCanvas from "../components/RoiCanvas";
import ModalConfirmacion from "../components/ModalConfirmacion";

const TIMEOUT_SNAPSHOT_SEGUNDOS = 5;
// Cadencia del refresco automático de snapshot con el toggle prendido: el doble que el
// polling de detecciones (2s). A diferencia de deteccion-actual (un dict en memoria, lectura
// prácticamente gratis), /camaras/{id}/snapshot abre una conexión RTSP nueva por pedido
// (cv2.VideoCapture, sin reusar stream — ver camaras.py) y la cierra al terminar: es una
// operación de red contra la cámara real, con un timeout de hasta TIMEOUT_SNAPSHOT_SEGUNDOS.
// Pedirla cada 2s como a las detecciones arriesgaría acumular pedidos más lentos que el
// propio intervalo; 4s le da margen de sobra para terminar antes del siguiente tick en el
// caso normal, y el guard de "en vuelo" cubre el resto.
const INTERVALO_SNAPSHOT_MS = 4000;



const estiloSelect: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid var(--color-gris-250)",
  borderRadius: 6,
  backgroundColor: "var(--color-blanco)",
};

const estiloError: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-error)",
  backgroundColor: "var(--color-error-fondo)",
  border: "1px solid var(--color-error-borde)",
  borderRadius: 6,
  padding: "8px 12px",
};

const estiloExito: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-exito)",
  backgroundColor: "var(--color-exito-fondo)",
  border: "1px solid var(--color-exito-borde)",
  borderRadius: 6,
  padding: "8px 12px",
};

export default function CalibracionRoiPage() {

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
  // ROI activo de la mesa elegida, si ya existía uno en esta cámara: no-null es lo que decide
  // si RoiCanvas entra en modo "editar" en vez de "crear". Su id es el que se manda a
  // roiMesaApi.actualizar/eliminar; sus coordenadas originales son las que "Deshacer cambios"
  // restaura (a diferencia de "Reiniciar" en modo creación, que vacía el draft).
  const [roiEnEdicion, setRoiEnEdicion] = useState<RoiMesa | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  // Borrar la zona espera confirmación en un modal propio, no en un window.confirm (T26-200/F-10).
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

  const [mostrarDetecciones, setMostrarDetecciones] = useState(false);

  useEffect(() => {
    Promise.all([camarasApi.listar(), mesasApi.listar()])
      .then(([camarasRes, mesasRes]) => {
        setCamaras(camarasRes.data);
        setMesas(mesasRes.data);
      })
      .catch(async (err: unknown) => {
        setErrorInicial(await extraerDetalle(err, "No se pudieron cargar cámaras y mesas"));
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
      setErrorRois(await extraerDetalle(err, "No se pudieron cargar los ROI existentes de esta cámara"));
    }
  }

  function handleCamaraChange(valor: string) {
    const id = valor === "" ? "" : Number(valor);
    setCamaraId(id);
    setMesaId("");
    setDraftPoints([]);
    setRoiEnEdicion(null);
    setSnapshotToken(0);
    setErrorGuardado(null);
    setExito(null);
    setRois([]);
    setErrorRois(null);
    setMostrarDetecciones(false);
    if (id !== "") cargarRois(id);
  }

  function handleMesaChange(valor: string) {
    const id = valor === "" ? "" : Number(valor);
    setMesaId(id);
    // Los ROI de la cámara ya están cargados (cargarRois corrió al elegirla): si la mesa
    // elegida tiene uno activo, se entra en modo edición con sus coordenadas en vez de
    // arrancar un draft vacío que terminaría chocando con un 409 al guardar.
    const roiExistente = id === "" ? undefined : rois.find((r) => r.mesa_id === id);
    setRoiEnEdicion(roiExistente ?? null);
    setDraftPoints(roiExistente ? [...roiExistente.coordenadas] : []);
    setErrorGuardado(null);
    setExito(null);
  }

  async function pedirSnapshotBlob(id: number): Promise<Blob> {
    try {
      const { data } = await camarasApi.snapshot(id, TIMEOUT_SNAPSHOT_SEGUNDOS);
      return data;
    } catch (err) {
      throw new Error(await extraerDetalle(err, "No se pudo obtener el frame de la cámara"));
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

  // snapshotLoading en un ref, no solo en el estado: el intervalo de abajo necesita leer su
  // valor más reciente en cada tick sin que eso lo obligue a recrearse (y reiniciar la cuenta
  // de 4s) cada vez que una carga arranca o termina.
  const snapshotLoadingRef = useRef(snapshotLoading);
  useEffect(() => {
    snapshotLoadingRef.current = snapshotLoading;
  }, [snapshotLoading]);

  // Refresco automático del snapshot mientras el toggle está prendido, reusando el mismo
  // mecanismo que "Actualizar frame" (bump de snapshotToken -> useObjectUrl arriba dispara el
  // pedido). El botón manual sigue funcionando igual, prendido o apagado el toggle.
  //
  // El toggle solo puede activarse con snapshotSrc ya cargado (ver el checkbox más abajo), así
  // que no hace falta repetir esa condición acá: alcanza con mostrarDetecciones + camaraId.
  // Guard de "en vuelo": si el pedido anterior todavía no volvió, ese tick no dispara uno
  // nuevo — evita acumular conexiones RTSP concurrentes contra la misma cámara. Al apagar el
  // toggle, cambiar de cámara (que además apaga el toggle, ver handleCamaraChange) o
  // desmontar la página, el cleanup corta el intervalo — mismo chequeo que useDeteccionActual.
  useEffect(() => {
    if (!mostrarDetecciones || camaraId === "") return;

    const intervalId = setInterval(() => {
      if (!snapshotLoadingRef.current) {
        setSnapshotToken((prev) => prev + 1);
      }
    }, INTERVALO_SNAPSHOT_MS);

    return () => clearInterval(intervalId);
  }, [mostrarDetecciones, camaraId]);

  // Solo pide de verdad mientras el toggle está prendido y hay algo sobre lo que superponer
  // la detección (cámara elegida + snapshot ya cargado). Al apagar el toggle, cambiar de
  // cámara o desmontar la página, camaraParaDeteccion pasa a null y useDeteccionActual corta
  // su propio setInterval — no queda nada corriendo en segundo plano.
  const camaraParaDeteccion = mostrarDetecciones && camaraId !== "" && snapshotSrc ? camaraId : null;
  const { deteccion: deteccionActual, error: errorDeteccion } = useDeteccionActual(camaraParaDeteccion);

  // Los ROI ya guardados de la MISMA mesa no deberían existir en paralelo con un draft nuevo
  // (crear otro para el mismo par mesa+cámara da 409, ver handleFinalizar), pero de todos
  // modos se excluyen del overlay de "solo lectura": lo que importa mostrar ahí son las
  // zonas de las demás mesas, no la que se está por definir.
  const roisDeOtrasMesas = rois.filter((r) => r.mesa_id !== mesaId);

  function handleReiniciar() {
    // En modo edición "reiniciar" es deshacer arrastres/borrados y volver al polígono tal
    // como está guardado, no vaciar el draft — vaciarlo dejaría la zona sin puntos hasta
    // guardar, que no es lo que alguien espera de un botón que dice "reiniciar" sobre una
    // zona que ya existe.
    setDraftPoints(roiEnEdicion ? [...roiEnEdicion.coordenadas] : []);
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
        // No debería pasar en uso normal (handleMesaChange ya detecta el ROI existente y
        // pasa a modo edición): solo llega acá si alguien más creó la zona entre que se
        // cargaron los ROI de la cámara y que se apretó "Finalizar".
        setErrorGuardado(
          "Ya existe una zona activa para esta mesa en esta cámara: volvé a elegirla en el selector para editarla."
        );
      } else {
        setErrorGuardado(await extraerDetalle(err, "No se pudo guardar la zona"));
      }
    } finally {
      setGuardando(false);
    }
  }

  async function handleGuardarEdicion() {
    if (!roiEnEdicion || draftPoints.length < 3) return;
    setGuardando(true);
    setErrorGuardado(null);
    setExito(null);
    try {
      const { data } = await roiMesaApi.actualizar(roiEnEdicion.id, { coordenadas: draftPoints });
      setRoiEnEdicion(data);
      setDraftPoints(data.coordenadas);
      setExito("Cambios guardados.");
      if (camaraId !== "") await cargarRois(camaraId);
    } catch (err) {
      setErrorGuardado(await extraerDetalle(err, "No se pudieron guardar los cambios"));
    } finally {
      setGuardando(false);
    }
  }

  function handleEliminarZona() {
    if (!roiEnEdicion) return;
    setConfirmandoBorrado(true);
  }

  async function eliminarZonaConfirmada() {
    if (!roiEnEdicion) return;
    const mesa = mesas.find((m) => m.id === mesaId);
    setConfirmandoBorrado(false);
    setGuardando(true);
    setErrorGuardado(null);
    setExito(null);
    try {
      await roiMesaApi.eliminar(roiEnEdicion.id);
      setRoiEnEdicion(null);
      setDraftPoints([]);
      setExito(`Zona eliminada. Podés dibujar una nueva para la mesa ${mesa?.numero ?? mesaId}.`);
      if (camaraId !== "") await cargarRois(camaraId);
    } catch (err) {
      setErrorGuardado(await extraerDetalle(err, "No se pudo eliminar la zona"));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Layout>
      <main className="app-main flex flex-col gap-[16px] max-w-[900px]">
        {cargandoInicial && <p className="text-[14px] text-gris-400">Cargando cámaras y mesas...</p>}
        {errorInicial && <p style={estiloError}>{errorInicial}</p>}

        {!cargandoInicial && !errorInicial && (
          <>
            <div className="flex gap-[16px] flex-wrap items-center">
              <label className="text-[13px] text-gris-600 flex flex-col gap-[4px]">
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
                <label className="text-[13px] text-gris-600 flex flex-col gap-[4px]">
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
                <div style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "flex-end" }}>
                  <Boton
                    onClick={() => setSnapshotToken((n) => n + 1)}
                    disabled={mostrarDetecciones}
                    cargando={snapshotLoading}
                    textoCargando="Cargando frame..."
                  >
                    Actualizar frame
                  </Boton>
                  {/* Deshabilitado por el toggle, no por estar cargando: sin esto el botón
                      apagado se ve roto en vez de intencional. */}
                  {mostrarDetecciones && (
                    <span className="text-[11px] text-gris-400">Se actualiza solo cada 4s</span>
                  )}
                </div>
              )}

              {camaraId !== "" && (
                <label
                  style={{
                    fontSize: 13,
                    color: "var(--color-gris-600)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    alignSelf: "flex-end",
                    paddingBottom: 6,
                    opacity: snapshotSrc ? 1 : 0.5,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={mostrarDetecciones}
                    disabled={!snapshotSrc}
                    onChange={(e) => setMostrarDetecciones(e.target.checked)}
                  />
                  Mostrar detecciones en vivo
                </label>
              )}
            </div>

            {camaras.length === 0 && (
              <p className="text-[13px] text-gris-500">No hay cámaras activas dadas de alta todavía.</p>
            )}

            {errorRois && <p style={estiloError}>{errorRois}</p>}

            {camaraId !== "" && mesaId === "" && (
              <p className="text-[13px] text-gris-500">Elegí una mesa para poder dibujar su zona.</p>
            )}

            {camaraId !== "" && snapshotToken === 0 && !snapshotLoading && (
              <p className="text-[13px] text-gris-500">
                Apretá "Actualizar frame" para traer una imagen actual de la cámara.
              </p>
            )}

            {snapshotError && (
              <p style={estiloError}>{snapshotError} — probá "Actualizar frame" de nuevo.</p>
            )}

            {mostrarDetecciones && snapshotSrc && (
              <p style={{ fontSize: 12, color: errorDeteccion ? "var(--color-error)" : "var(--color-gris-400)" }}>
                {errorDeteccion ??
                  (deteccionActual
                    ? `Detección en vivo: ${deteccionActual.detections.length} objeto(s) en el último frame de vision-module.`
                    : "Detección en vivo: todavía no llegó ninguna de esta cámara.")}
              </p>
            )}

            {snapshotSrc && mesaId !== "" && (
              <>
                {roiEnEdicion && (
                  <p className="text-[13px] text-marca">
                    Editando la zona ya guardada de esta mesa: arrastrá un vértice para moverlo, doble click
                    para borrarlo.
                  </p>
                )}

                <RoiCanvas
                  snapshotSrc={snapshotSrc}
                  roisExistentes={roisDeOtrasMesas}
                  draftPoints={draftPoints}
                  mesaSeleccionadaNumero={mesas.find((m) => m.id === mesaId)?.numero}
                  onAddPoint={(punto) => setDraftPoints((prev) => [...prev, punto])}
                  modo={roiEnEdicion ? "editar" : "crear"}
                  onMoverPunto={(indice, punto) =>
                    setDraftPoints((prev) => prev.map((p, i) => (i === indice ? punto : p)))
                  }
                  onBorrarPunto={(indice) =>
                    setDraftPoints((prev) => (prev.length <= 3 ? prev : prev.filter((_, i) => i !== indice)))
                  }
                  deteccionActual={mostrarDetecciones ? deteccionActual : null}
                />

                <div className="flex items-center gap-[12px] flex-wrap">
                  <span className="text-[13px] text-gris-600">
                    {draftPoints.length} punto{draftPoints.length === 1 ? "" : "s"} (mínimo 3)
                  </span>
                  {roiEnEdicion ? (
                    <>
                      <Boton onClick={handleReiniciar} disabled={guardando}>
                        Deshacer cambios
                      </Boton>
                      <Boton
                        variante="primario"
                        onClick={handleGuardarEdicion}
                        disabled={draftPoints.length < 3}
                        cargando={guardando}
                        textoCargando="Guardando..."
                      >
                        Guardar cambios
                      </Boton>
                      <Boton variante="peligro" onClick={handleEliminarZona} disabled={guardando}>
                        Eliminar zona
                      </Boton>
                    </>
                  ) : (
                    <>
                      <Boton onClick={handleReiniciar} disabled={draftPoints.length === 0 || guardando}>
                        Reiniciar
                      </Boton>
                      <Boton
                        variante="primario"
                        onClick={handleFinalizar}
                        disabled={draftPoints.length < 3}
                        cargando={guardando}
                        textoCargando="Guardando..."
                      >
                        Finalizar zona
                      </Boton>
                    </>
                  )}
                </div>
              </>
            )}

            {errorGuardado && <p style={estiloError}>{errorGuardado}</p>}
            {exito && <p style={estiloExito}>{exito}</p>}
          </>
        )}
      </main>

      {confirmandoBorrado && (
        <ModalConfirmacion
          titulo="Eliminar zona"
          mensaje={`¿Eliminar la zona de la mesa ${mesas.find((m) => m.id === mesaId)?.numero ?? mesaId}?`}
          etiquetaConfirmar="Eliminar"
          onConfirmar={eliminarZonaConfirmada}
          onCancelar={() => setConfirmandoBorrado(false)}
        />
      )}
    </Layout>
  );
}
