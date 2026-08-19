// Pide GET /camaras/{id}/deteccion-actual cada dos segundos mientras camaraId no sea null,
// para superponer las detecciones en vivo de vision-module sobre el frame en
// CalibracionRoiPage. El intervalo está alineado a FRAME_INTERVAL_SECONDS del módulo de
// visión (default 2s, ver docs/vision-loop.md): pedir más seguido solo trae el mismo valor
// repetido.
//
// Misma disciplina de cancelación que useObjectUrl: flag "cancelado" + limpieza del
// intervalo al desmontar o cambiar de dependencias, para no hacer setState después de
// desmontado ni dejar un setInterval corriendo en segundo plano al cambiar de cámara.
//
// Un 404 no es un error de red: significa que vision-module todavía no publicó nada para
// esta cámara (docs/privacidad-vision.md §3), así que no pisa `error` — se refleja en
// `disponible: false` para que la UI lo muestre como "vista en vivo no disponible todavía",
// no como un fallo. Sin backoff: la cadencia de 2s ya es lo bastante espaciada.

import { useEffect, useState } from "react";
import type { AxiosError } from "axios";
import { camarasApi } from "../services/api";
import type { DetectionFrameResult } from "../types";

const INTERVALO_MS = 2000;

interface DeteccionActualState {
  deteccion: DetectionFrameResult | null;
  disponible: boolean;
  error: string | null;
}

const ESTADO_INICIAL: DeteccionActualState = { deteccion: null, disponible: false, error: null };

export function useDeteccionActual(camaraId: number | null): DeteccionActualState {
  const [estado, setEstado] = useState<DeteccionActualState>(ESTADO_INICIAL);

  useEffect(() => {
    if (camaraId === null) {
      setEstado(ESTADO_INICIAL);
      return;
    }

    let cancelado = false;

    async function pedir() {
      try {
        const { data } = await camarasApi.deteccionActual(camaraId as number);
        if (!cancelado) setEstado({ deteccion: data, disponible: true, error: null });
      } catch (err) {
        if (cancelado) return;
        const axiosErr = err as AxiosError;
        if (axiosErr.response?.status === 404) {
          setEstado({ deteccion: null, disponible: false, error: null });
        } else {
          setEstado({ deteccion: null, disponible: false, error: "No se pudo obtener la detección en vivo" });
        }
      }
    }

    pedir();
    const intervalId = setInterval(pedir, INTERVALO_MS);

    return () => {
      cancelado = true;
      clearInterval(intervalId);
    };
  }, [camaraId]);

  return estado;
}
