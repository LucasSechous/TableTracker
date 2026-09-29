// Canvas 2D que representa el salón del restaurante con sectores y mesas posicionados.
// Presentacional salvo por el resize de su propio borde (solo admin, en modo edición): mantiene
// un estado local optimista durante el arrastre, igual que SectorBloque con sus sectores.
// El click en una mesa (modo monitoreo) abre PanelMesa con el detalle y la corrección manual
// de estado (RF-17), en vez del selector inline que había antes directamente sobre el canvas.

import { useState, useEffect } from "react"
import type { CSSProperties, ReactNode } from "react"
import type { Sector, Mesa, Modo } from "../types"
import SectorBloque from "./SectorBloque"
import PanelMesa from "./PanelMesa"
import { COLOR_POR_ESTADO, ETIQUETA_POR_ESTADO, ICONO_POR_ESTADO, calcularMinimoSalon } from "../constants"
import { useAuth } from "../hooks/useAuth"
import { useArrastre } from "../hooks/useArrastre"
import { esAdmin } from "../permisos"

interface Props {
  sectores: Sector[]
  modo: Modo
  anchoSalon: number
  altoSalon: number
  /** Umbral de limpieza demorada, de paso hacia MesaVisual (T26-173). */
  umbralLimpiezaMinutos?: number | null
  /**
   * Control de filtro por estado, dibujado a la derecha de los tabs de sector para que los
   * dos filtros del salón queden en la misma fila. Lo arma DashboardPage —que es quien tiene
   * el estado del filtro—; acá solo se le reserva el lugar. Ausente en modo edición, donde
   * el filtro no se ofrece.
   */
  filtroEstado?: ReactNode
  onMesaEstadoChange: (mesaId: number, nuevoEstado: string) => void
  onMesaPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onSectorPosicionChange: (sectorId: number, pos_x: number, pos_y: number) => void
  onSectorResize: (sectorId: number, ancho: number, alto: number) => void
  onSectorActualizado: (sector: Sector) => void
  onSectorEliminado: (sectorId: number) => void
  onMesaActualizada: (mesa: Mesa) => void
  onMesaEliminada: (mesaId: number) => void
  onSalonResize: (ancho: number, alto: number) => void
}

export default function SalonCanvas({
  sectores,
  modo,
  anchoSalon,
  altoSalon,
  umbralLimpiezaMinutos,
  filtroEstado,
  onMesaEstadoChange,
  onMesaPosicionChange,
  onSectorPosicionChange,
  onSectorResize,
  onSectorActualizado,
  onSectorEliminado,
  onMesaActualizada,
  onMesaEliminada,
  onSalonResize,
}: Props) {
  // El rol sale del contexto, igual que en MesaVisual, SectorBloque y PanelMesa (T26-200/F-12).
  // Antes llegaba como prop `esAdmin` desde DashboardPage, así que el mismo dato entraba al
  // canvas por dos caminos —prop y contexto— y la prop podía quedar desfasada de aquel del
  // que se derivó.
  const { rol } = useAuth()
  const puedeRedimensionar = modo === "edicion" && esAdmin(rol)

  const [localSize, setLocalSize] = useState({ ancho: anchoSalon, alto: altoSalon })

  const [sectorFiltrado, setSectorFiltrado] = useState<number | null>(null)
  const [mesaSeleccionadaId, setMesaSeleccionadaId] = useState<number | null>(null)

  const resize = useArrastre({
    // El mínimo es el espacio que ocupan los sectores activos (para no dejarlos fuera del
    // salón al achicar), igual que el mínimo de un sector se calcula a partir de sus mesas.
    // No hay techo: a diferencia de un sector, el salón no vive contenido en nada más.
    // El cálculo se comparte con la pantalla de configuración (ver constants.ts).
    //
    // Se recalcula acá adentro y no en el cuerpo del componente porque solo hace falta
    // mientras se arrastra: fuera de un resize, recorrer todos los sectores en cada render
    // sería trabajo para nadie.
    ajustar: (inicial, dx, dy) => {
      const minimo = calcularMinimoSalon(sectores)
      return {
        x: Math.max(minimo.ancho, inicial.x + dx),
        y: Math.max(minimo.alto, inicial.y + dy),
      }
    },
    onMover: ({ x, y }) => setLocalSize({ ancho: x, alto: y }),
    onSoltar: ({ x, y }) => onSalonResize(x, y),
  })

  useEffect(() => {
    if (!resize.enCurso()) {
      setLocalSize({ ancho: anchoSalon, alto: altoSalon })
    }
  }, [anchoSalon, altoSalon, resize])

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (!puedeRedimensionar) return
    e.preventDefault()
    e.stopPropagation()
    resize.iniciar(e, { x: localSize.ancho, y: localSize.alto })
  }

  const sectoresActivos = sectores.filter((s) => s.activo)
  const sectoresVisibles =
    sectorFiltrado === null ? sectoresActivos : sectoresActivos.filter((s) => s.id === sectorFiltrado)

  const mesaSeleccionada =
    mesaSeleccionadaId === null
      ? null
      : sectores.flatMap((s) => s.mesas ?? []).find((m) => m.id === mesaSeleccionadaId) ?? null

  return (
    // La columna del salón: leyenda, filtros y canvas comparten exactamente el ancho del
    // canvas. Es lo que alinea el borde derecho del filtro de estado con el del salón —sin
    // esto la fila de filtros se estira hasta el ancho del <main>, que es más ancho—. El
    // preflight de Tailwind aplica border-box, así que este ancho ya incluye el borde de 2px
    // del canvas. Sigue a localSize (y no a anchoSalon) para no descolgarse mientras se
    // arrastra el resize.
    // maxWidth 100%: el salon tiene un ancho fijo en pixeles (sale de la configuracion,
    // tipicamente 1200) y en una pantalla angosta desbordaria el <main> y haria scrollear
    // horizontalmente la pagina ENTERA, encabezado fijo incluido. Con el techo, la columna
    // se achica y el que scrollea es el canvas, unos nodos mas abajo.
    <div style={{ width: localSize.ancho, maxWidth: "100%" }}>
      <div
        className="flex flex-wrap gap-[16px] mb-[12px]"
      >
        {Object.entries(COLOR_POR_ESTADO).map(([estado, color]) => {
          const Icono = ICONO_POR_ESTADO[estado]
          return (
          <div key={estado} className="flex items-center gap-[6px]">
            {/* La muestra de la leyenda lleva el mismo icono que la mesa, y no solo el
                color: es lo que permite aprender la correspondencia icono-estado mirando
                acá, y lo que hace que la leyenda siga sirviendo en blanco y negro. */}
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 3,
                backgroundColor: color,
                color: "var(--color-blanco)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {Icono && <Icono size={12} aria-hidden />}
            </span>
            <span className="text-[13px] text-slate-600 font-medium">
              {ETIQUETA_POR_ESTADO[estado] ?? estado}
            </span>
          </div>
          )
        })}
      </div>

      {/* Los dos filtros del salón —sector y estado— comparten fila. Envuelve con flexWrap
          para que en pantallas angostas el de estado baje entero a la línea de abajo en vez
          de comerse el ancho de los tabs. */}
      <div
        className="flex items-end gap-[16px] flex-wrap mb-[16px]"
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 4,
            // Los tabs absorben el ancho sobrante y scrollean dentro de sí mismos. minWidth:0
            // es lo que lo hace posible: sin eso un hijo flex no baja de su ancho de contenido
            // y, con muchos sectores, empujaría el filtro de estado fuera de la pantalla.
            flex: "1 1 320px",
            minWidth: 0,
          }}
        >
          <button onClick={() => setSectorFiltrado(null)} style={estiloTab(sectorFiltrado === null)}>
            Todos
          </button>
          {sectoresActivos.map((sector) => (
            <button
              key={sector.id}
              onClick={() => setSectorFiltrado(sector.id)}
              style={estiloTab(sectorFiltrado === sector.id)}
            >
              {sector.nombre}
            </button>
          ))}
        </div>
        {filtroEstado && <div className="shrink-0 ml-auto">{filtroEstado}</div>}
      </div>

      {/* El canvas conserva su tamano real y es este envoltorio el que scrollea: un salon
          es un plano a escala, y encogerlo para que entre en el ancho disponible dejaria
          las mesas demasiado chicas para tocarlas con el dedo. Arriba del breakpoint el
          contenido entra justo y la barra no aparece, asi que en escritorio no cambia nada. */}
      <div className="overflow-x-auto max-w-[100%]">
        <div
          style={{
            position: "relative",
            width: localSize.ancho,
            height: localSize.alto,
            backgroundColor: "#f0f0f0",
            border: "2px solid var(--color-gris-250)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {sectoresVisibles.map((sector) => (
            <SectorBloque
              key={sector.id}
              sector={sector}
              modo={modo}
              anchoSalon={localSize.ancho}
              altoSalon={localSize.alto}
              umbralLimpiezaMinutos={umbralLimpiezaMinutos}
              onMesaClick={(mesa) => setMesaSeleccionadaId(mesa.id)}
              onMesaPosicionChange={onMesaPosicionChange}
              onSectorDrag={onSectorPosicionChange}
              onSectorResize={onSectorResize}
              onSectorActualizado={onSectorActualizado}
              onSectorEliminado={onSectorEliminado}
              onMesaEliminada={onMesaEliminada}
            />
          ))}

          {puedeRedimensionar && (
            <div
              onMouseDown={handleResizeMouseDown}
              title="Redimensionar salón"
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: 14,
                height: 14,
                cursor: "nwse-resize",
                backgroundColor: "var(--color-marca)",
                borderTopLeftRadius: 4,
                zIndex: 4,
              }}
            />
          )}
        </div>
      </div>

      <PanelMesa
        mesa={mesaSeleccionada}
        onClose={() => setMesaSeleccionadaId(null)}
        onEstadoChange={onMesaEstadoChange}
        onMesaActualizada={onMesaActualizada}
      />
    </div>
  )
}

function estiloTab(activo: boolean): CSSProperties {
  return {
    padding: "10px 18px",
    minHeight: 44,
    borderRadius: 8,
    border: activo ? "2px solid var(--color-marca)" : "2px solid var(--color-slate-300)",
    backgroundColor: activo ? "var(--color-marca)" : "var(--color-blanco)",
    color: activo ? "var(--color-blanco)" : "var(--color-slate-500)",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  }
}
