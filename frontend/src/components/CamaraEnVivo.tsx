// Vista en vivo de una cámara (T26-203, RF-31).
//
// Por qué no es un <video>: ningún navegador reproduce RTSP, así que el backend
// reempaqueta el stream como MJPEG (`GET /camaras/{id}/stream`, multipart/x-mixed-replace).
//
// Y por qué no es un <img src="/camaras/5/stream"> a secas, que sería lo obvio con MJPEG:
// un <img> no manda el header Authorization, y ese endpoint exige rol admin como todo el
// router de cámaras. Poner el token en la query string lo dejaría en el historial del
// navegador y en los logs del servidor. En vez de eso se baja el stream con fetch —que sí
// lleva el header—, se van separando los JPEG a medida que llegan y cada uno se muestra
// como object URL. El <img> nunca toca la red.
//
// Los frames se separan por los marcadores del propio JPEG (SOI ffd8 / EOI ffd9) y no
// parseando las cabeceras multipart: es menos código, no depende de cómo el servidor
// formatee la frontera, y un JPEG no puede contener esos bytes fuera de lugar.

import { useEffect, useRef, useState } from "react";

const ANCHO = 280;

// Marcadores de inicio y fin de un JPEG.
const SOI_1 = 0xff;
const SOI_2 = 0xd8;
const EOI_2 = 0xd9;

// Si el buffer crece más que esto sin cerrar un JPEG, algo viene mal (no es MJPEG, o se
// perdió el sincronismo). Se corta en vez de comerse la memoria de la pestaña.
const BUFFER_MAXIMO = 12 * 1024 * 1024;

interface Props {
  camaraId: number;
  nombre: string;
}

const estiloMarco: React.CSSProperties = {
  width: ANCHO,
  height: Math.round((ANCHO * 9) / 16),
  borderRadius: 6,
  border: "1px solid var(--color-gris-200)",
  backgroundColor: "#111",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  color: "#bbb",
  textAlign: "center",
  padding: 8,
  boxSizing: "border-box",
  overflow: "hidden",
};

export default function CamaraEnVivo({ camaraId, nombre }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);
  // El object URL vigente vive en un ref y no en el estado: hay que revocar el anterior
  // en cada frame, y leerlo del estado dentro del bucle daría siempre el valor capturado
  // al montar.
  const urlVigente = useRef<string | null>(null);

  useEffect(() => {
    const controlador = new AbortController();
    let cancelado = false;

    function mostrar(jpeg: Uint8Array<ArrayBuffer>) {
      const url = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
      if (urlVigente.current) URL.revokeObjectURL(urlVigente.current);
      urlVigente.current = url;
      setSrc(url);
      setFrames((n) => n + 1);
    }

    async function reproducir() {
      const base = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
      const token = localStorage.getItem("token");
      try {
        const respuesta = await fetch(`${base}/camaras/${camaraId}/stream`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controlador.signal,
        });
        if (!respuesta.ok || !respuesta.body) {
          throw new Error(await detalleDeError(respuesta));
        }

        const lector = respuesta.body.getReader();
        let buffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);

        while (!cancelado) {
          const { done, value } = await lector.read();
          if (done) break;
          if (!value) continue;

          buffer = concatenar(buffer, value);
          if (buffer.length > BUFFER_MAXIMO) {
            throw new Error("El stream no entregó imágenes reconocibles");
          }

          // Puede haber llegado más de un frame en la misma lectura, y conviene mostrar
          // solo el último: quedarse atrás renderizando los viejos es lo que hace que una
          // vista "en vivo" se vaya atrasando sola.
          let ultimo: Uint8Array<ArrayBuffer> | null = null;
          for (;;) {
            const corte = extraerJpeg(buffer);
            if (!corte) break;
            ultimo = corte.jpeg;
            buffer = corte.resto;
          }
          if (ultimo) mostrar(ultimo);
        }
      } catch (err) {
        // Abortar al desmontar entra por acá y no es un error que mostrar.
        if (cancelado || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    reproducir();

    return () => {
      cancelado = true;
      controlador.abort();
      if (urlVigente.current) {
        URL.revokeObjectURL(urlVigente.current);
        urlVigente.current = null;
      }
    };
  }, [camaraId]);

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, width: ANCHO }}>
        <div style={{ ...estiloMarco, color: "#ef6c00", borderColor: "#ffcc80", backgroundColor: "var(--color-aviso-fondo)" }}>
          Respondió, pero no se pudo ver en vivo
        </div>
        <span className="text-[11px] text-gris-400">{error}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, width: ANCHO }}>
      {src ? (
        <img
          src={src}
          alt={`Vista en vivo de ${nombre}`}
          style={{ width: ANCHO, borderRadius: 6, border: "1px solid var(--color-exito-borde)", display: "block" }}
        />
      ) : (
        <div style={estiloMarco}>Conectando con la cámara...</div>
      )}
      <span className="text-[11px] text-gris-400">
        {src ? `En vivo · ${frames} ${frames === 1 ? "frame" : "frames"}` : "Abriendo el stream"}
      </span>
    </div>
  );
}

function concatenar(a: Uint8Array<ArrayBuffer>, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const junto = new Uint8Array(a.length + b.length);
  junto.set(a, 0);
  junto.set(b, a.length);
  return junto;
}

/** Primer JPEG completo del buffer y lo que queda después, o null si todavía no cerró. */
function extraerJpeg(
  buffer: Uint8Array<ArrayBuffer>
): { jpeg: Uint8Array<ArrayBuffer>; resto: Uint8Array<ArrayBuffer> } | null {
  let inicio = -1;
  for (let i = 0; i + 1 < buffer.length; i++) {
    if (buffer[i] === SOI_1 && buffer[i + 1] === SOI_2) {
      inicio = i;
      break;
    }
  }
  if (inicio === -1) return null;

  for (let i = inicio + 2; i + 1 < buffer.length; i++) {
    if (buffer[i] === SOI_1 && buffer[i + 1] === EOI_2) {
      return {
        jpeg: new Uint8Array(buffer.subarray(inicio, i + 2)),
        resto: new Uint8Array(buffer.subarray(i + 2)),
      };
    }
  }
  return null;
}

async function detalleDeError(respuesta: Response): Promise<string> {
  try {
    const cuerpo = await respuesta.json();
    if (typeof cuerpo?.detail === "string") return cuerpo.detail;
  } catch {
    // El cuerpo no era JSON: alcanza con el código.
  }
  return `El servidor respondió ${respuesta.status}`;
}
