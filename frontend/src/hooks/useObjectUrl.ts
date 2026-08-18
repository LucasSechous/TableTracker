// Pide un blob autenticado (por ejemplo camarasApi.snapshot, que exige el header
// Authorization y por eso no se puede usar directo en un <img src="...">) y lo expone como
// object URL para <img src>. Revoca el object URL anterior en cada re-fetch y al desmontar,
// para no ir acumulando blobs en memoria.

import { useEffect, useState } from "react";

interface ObjectUrlState {
  src: string | null;
  error: string | null;
  loading: boolean;
}

export function useObjectUrl(
  fetchBlob: (() => Promise<Blob>) | null,
  deps: unknown[]
): ObjectUrlState {
  const [estado, setEstado] = useState<ObjectUrlState>({ src: null, error: null, loading: false });

  useEffect(() => {
    if (!fetchBlob) {
      setEstado({ src: null, error: null, loading: false });
      return;
    }

    let cancelado = false;
    let objectUrl: string | null = null;
    setEstado((prev) => ({ ...prev, loading: true }));

    fetchBlob()
      .then((blob) => {
        if (cancelado) return;
        objectUrl = URL.createObjectURL(blob);
        setEstado({ src: objectUrl, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (!cancelado) {
          setEstado({ src: null, error: err instanceof Error ? err.message : String(err), loading: false });
        }
      });

    return () => {
      cancelado = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps es dinámico (parámetro del hook)
  }, deps);

  return estado;
}
