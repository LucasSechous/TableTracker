// Frame de referencia de la cámara + overlay SVG para dibujar o editar una zona ROI
// (T26-128: creación; T26-144: edición de una zona ya guardada — arrastrar/borrar vértice).
//
// Los puntos se manejan en píxeles reales de la imagen devuelta por el backend, el mismo
// sistema de coordenadas que espera la API (`coordenadas`), sin conversión al guardar. La
// conversión pantalla→frame real (clientX/clientY contra naturalWidth/naturalHeight) se hace
// en el click para agregar un punto (modo "crear") y en el arrastre de un vértice (modo
// "editar"). El <svg> superpuesto usa esas mismas dimensiones reales como viewBox, así que
// todo lo demás (polígonos existentes, líneas en progreso) se escala solo para verse bien a
// cualquier tamaño en pantalla.
//
// "editar" reutiliza el mismo `draftPoints` que "crear": quien llama arranca el draft con las
// coordenadas del ROI ya guardado en vez de vacío. Por eso el trazo (polyline + línea de
// cierre + círculos de vértice) es el mismo bloque de JSX en los dos modos; lo único que
// cambia es la interacción: en "crear" el click de fondo agrega un punto, en "editar" cada
// vértice se puede arrastrar (pointer capture, no requiere estado de "cuál se está arrastrando":
// el navegador ya dirige los eventos al círculo que hizo el pointerdown) o borrar con doble
// click. Insertar un vértice en el medio de un lado no está soportado en ningún modo.

import { useEffect, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { DetectionFrameResult, PuntoRoi, RoiMesa } from "../types";

interface Props {
  snapshotSrc: string;
  roisExistentes: RoiMesa[];
  draftPoints: PuntoRoi[];
  // Número de la mesa que se está dibujando (no el mesa_id), para etiquetar el polígono en
  // progreso apenas tiene forma cerrable. Los ROI ya guardados no lo necesitan como prop:
  // RoiMesaResponse ya trae mesa_numero resuelto por el backend.
  mesaSeleccionadaNumero?: number;
  onAddPoint: (punto: PuntoRoi) => void;
  // "crear" (default): click de fondo agrega un vértice al final. "editar": el click de fondo
  // no hace nada, los vértices existentes se arrastran y se borran con doble click.
  modo?: "crear" | "editar";
  onMoverPunto?: (indice: number, punto: PuntoRoi) => void;
  onBorrarPunto?: (indice: number) => void;
  // Último resultado de vision-module para esta cámara (T26-150), o null/undefined si el
  // toggle de "detecciones en vivo" está apagado o todavía no llegó ninguno. Capa de solo
  // lectura, independiente de mesaSeleccionada: las detecciones son por cámara, no por mesa.
  deteccionActual?: DetectionFrameResult | null;
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

// Etiqueta chica de clase sobre un bounding box: misma técnica de contorno oscuro + relleno
// claro que EtiquetaMesa (se lee sobre cualquier fondo), pero alineada a la izquierda y
// pegada arriba del rect en vez de centrada — es la convención habitual para labels de
// detección, y no depende de conocer un centroide.
function EtiquetaDeteccion({ x, y, texto, fontSize }: { x: number; y: number; texto: string; fontSize: number }): ReactNode {
  return (
    <text
      x={x}
      y={y}
      fontSize={fontSize}
      fontWeight={700}
      fill="#fff"
      stroke="#000"
      strokeWidth={fontSize * 0.28}
      paintOrder="stroke"
      style={{ pointerEvents: "none" }}
    >
      {texto}
    </text>
  );
}

export default function RoiCanvas({
  snapshotSrc,
  roisExistentes,
  draftPoints,
  mesaSeleccionadaNumero,
  onAddPoint,
  modo = "crear",
  onMoverPunto,
  onBorrarPunto,
  deteccionActual,
}: Props) {
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

  // Coordenadas de pantalla → coordenadas reales del frame, recortadas a los límites de la
  // imagen: a diferencia del click (que solo puede ocurrir dentro del <svg>), un arrastre con
  // pointer capture sigue entregando pointermove aunque el cursor salga del frame, y mandar
  // una coordenada negativa al backend da 422 (roi_mesa.py: _validar_coordenadas).
  function puntoDesdeEvento(e: PointerEvent<SVGCircleElement>): PuntoRoi | null {
    if (!naturalSize) return null;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * naturalSize.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * naturalSize.height);
    return [Math.min(naturalSize.width, Math.max(0, x)), Math.min(naturalSize.height, Math.max(0, y))];
  }

  function handleVerticePointerDown(e: PointerEvent<SVGCircleElement>) {
    if (modo !== "editar") return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleVerticePointerMove(indice: number) {
    return (e: PointerEvent<SVGCircleElement>) => {
      if (modo !== "editar" || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const punto = puntoDesdeEvento(e);
      if (punto) onMoverPunto?.(indice, punto);
    };
  }

  function handleVerticePointerUp(e: PointerEvent<SVGCircleElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function handleVerticeDoubleClick(indice: number) {
    return (e: MouseEvent<SVGCircleElement>) => {
      if (modo !== "editar" || draftPoints.length <= 3) return;
      e.stopPropagation();
      onBorrarPunto?.(indice);
    };
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
          onClick={modo === "editar" ? undefined : handleClick}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: modo === "editar" ? "default" : "crosshair",
          }}
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

          {deteccionActual && deteccionActual.detections.length > 0 && (
            <g>
              {(() => {
                // Los bounding boxes vienen en píxeles del frame que analizó vision-module
                // (deteccionActual.frame_width/height), que puede no ser exactamente el mismo
                // frame que el snapshot mostrado en pantalla. Se escala proporcionalmente
                // contra naturalSize en vez de asumir que coinciden; cuando sí coinciden la
                // escala es 1 y no cambia nada.
                const escalaX = naturalSize.width / deteccionActual.frame_width;
                const escalaY = naturalSize.height / deteccionActual.frame_height;
                return deteccionActual.detections.map((deteccion, i) => {
                  const { x1, y1, x2, y2 } = deteccion.bbox;
                  const rx = x1 * escalaX;
                  const ry = y1 * escalaY;
                  return (
                    <g key={i}>
                      <rect
                        x={rx}
                        y={ry}
                        width={(x2 - x1) * escalaX}
                        height={(y2 - y1) * escalaY}
                        fill="none"
                        stroke="#8e24aa"
                        strokeWidth={2}
                      />
                      <EtiquetaDeteccion x={rx} y={ry - 4} texto={deteccion.class_name} fontSize={Math.max(12, fontSize * 0.6)} />
                    </g>
                  );
                });
              })()}
            </g>
          )}

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
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={5}
                  fill="#1976d2"
                  style={modo === "editar" ? { cursor: "grab", touchAction: "none" } : undefined}
                  onPointerDown={handleVerticePointerDown}
                  onPointerMove={handleVerticePointerMove(i)}
                  onPointerUp={handleVerticePointerUp}
                  onDoubleClick={handleVerticeDoubleClick(i)}
                >
                  {modo === "editar" && <title>Arrastrar para mover · doble click para borrar (mínimo 3 puntos)</title>}
                </circle>
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
