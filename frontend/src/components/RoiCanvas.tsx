// Frame de referencia de la cámara + overlay SVG para dibujar una zona ROI nueva
// (T26-128 v1, solo creación — editar una zona ya guardada es T26-144).
//
// Los puntos se manejan en píxeles reales de la imagen devuelta por el backend, el mismo
// sistema de coordenadas que espera POST /roi-mesa/ (RoiMesaCreate.coordenadas), sin
// conversión al guardar. El único lugar donde se convierte es el click: de coordenadas de
// pantalla (clientX/clientY) a coordenadas del frame real, usando el tamaño renderizado del
// <img> contra su naturalWidth/naturalHeight. El <svg> superpuesto usa esas mismas dimensiones
// reales como viewBox, así que todo lo demás (polígonos existentes, líneas en progreso) se
// escala solo para verse bien a cualquier tamaño en pantalla.

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { PuntoRoi, RoiMesa } from "../types";

interface Props {
  snapshotSrc: string;
  roisExistentes: RoiMesa[];
  draftPoints: PuntoRoi[];
  // Número de la mesa que se está dibujando (no el mesa_id), para etiquetar el polígono en
  // progreso apenas tiene forma cerrable. Los ROI ya guardados no lo necesitan como prop:
  // RoiMesaResponse ya trae mesa_numero resuelto por el backend.
  mesaSeleccionadaNumero?: number;
  onAddPoint: (punto: PuntoRoi) => void;
}

// Promedio de los vértices: no es el centroide exacto de área de un polígono irregular, pero
// para ubicar una etiqueta legible alcanza y de sobra (así lo pide el ticket).
function centroide(puntos: PuntoRoi[]): PuntoRoi {
  const n = puntos.length;
  const sumaX = puntos.reduce((acc, [x]) => acc + x, 0);
  const sumaY = puntos.reduce((acc, [, y]) => acc + y, 0);
  return [sumaX / n, sumaY / n];
}

// Contorno oscuro + relleno claro (en vez de un <rect> de fondo, que necesitaría medir el
// ancho del texto) para que el número se lea igual sobre un frame oscuro (visión nocturna) o
// claro, sin importar el color del polígono que tenga detrás. pointer-events:none en el <g>
// para que la etiqueta nunca se interponga en el click que agrega puntos al polígono.
function EtiquetaMesa({ x, y, numero, fontSize }: { x: number; y: number; numero: number; fontSize: number }): ReactNode {
  return (
    <g style={{ pointerEvents: "none" }}>
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
        fill="#fff"
        stroke="#000"
        strokeWidth={fontSize * 0.28}
        paintOrder="stroke"
      >
        {numero}
      </text>
    </g>
  );
}

export default function RoiCanvas({ snapshotSrc, roisExistentes, draftPoints, mesaSeleccionadaNumero, onAddPoint }: Props) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [errorCarga, setErrorCarga] = useState(false);

  // Cada frame nuevo ("Actualizar frame") trae una URL de blob distinta: si el intento
  // anterior había fallado, hay que limpiar ese estado para darle una chance real al nuevo.
  useEffect(() => {
    setNaturalSize(null);
    setErrorCarga(false);
  }, [snapshotSrc]);

  function handleClick(e: MouseEvent<SVGSVGElement>) {
    if (!naturalSize) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * naturalSize.width;
    const y = ((e.clientY - rect.top) / rect.height) * naturalSize.height;
    onAddPoint([Math.round(x), Math.round(y)]);
  }

  if (errorCarga) {
    return (
      <p style={{ fontSize: 13, color: "#c62828" }}>
        No se pudo mostrar el frame de la cámara como imagen.
      </p>
    );
  }

  // Proporcional a la resolución del frame: en un viewBox de píxeles reales, un tamaño fijo se
  // vería minúsculo en un frame HD y gigante en uno chico.
  const fontSize = naturalSize ? Math.max(18, naturalSize.height * 0.035) : 0;
  // La etiqueta del polígono en progreso solo tiene sentido con forma cerrable (3+ puntos) y
  // una mesa elegida en el selector.
  const draftCentroide =
    draftPoints.length >= 3 && mesaSeleccionadaNumero !== undefined ? centroide(draftPoints) : null;

  return (
    <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
      <img
        src={snapshotSrc}
        alt="Frame de referencia de la cámara"
        style={{ display: "block", maxWidth: "100%", borderRadius: 6, border: "1px solid #ccc", userSelect: "none" }}
        onLoad={(e) =>
          setNaturalSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
        onError={() => setErrorCarga(true)}
      />
      {naturalSize && (
        <svg
          viewBox={`0 0 ${naturalSize.width} ${naturalSize.height}`}
          onClick={handleClick}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair" }}
        >
          {roisExistentes.map((roi) => {
            const [cx, cy] = centroide(roi.coordenadas);
            return (
              <g key={roi.id}>
                <polygon
                  points={roi.coordenadas.map((p) => p.join(",")).join(" ")}
                  fill="rgba(230, 81, 0, 0.12)"
                  stroke="#e65100"
                  strokeWidth={2}
                />
                {roi.mesa_numero !== null && (
                  <EtiquetaMesa x={cx} y={cy} numero={roi.mesa_numero} fontSize={fontSize} />
                )}
              </g>
            );
          })}

          {draftPoints.length > 0 && (
            <>
              <polyline
                points={draftPoints.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke="#1976d2"
                strokeWidth={2}
              />
              {draftPoints.length >= 2 && (
                <line
                  x1={draftPoints[draftPoints.length - 1][0]}
                  y1={draftPoints[draftPoints.length - 1][1]}
                  x2={draftPoints[0][0]}
                  y2={draftPoints[0][1]}
                  stroke="#1976d2"
                  strokeOpacity={0.4}
                  strokeWidth={2}
                  strokeDasharray="6,6"
                />
              )}
              {draftPoints.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={5} fill="#1976d2" />
              ))}
              {draftCentroide && mesaSeleccionadaNumero !== undefined && (
                <EtiquetaMesa x={draftCentroide[0]} y={draftCentroide[1]} numero={mesaSeleccionadaNumero} fontSize={fontSize} />
              )}
            </>
          )}
        </svg>
      )}
    </div>
  );
}
