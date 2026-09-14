// Bloque visual de un sector del restaurante sobre el canvas del salón.
// En modo edición el bloque completo es arrastrable y redimensionable desde su esquina
// inferior derecha; contiene sus mesas activas como MesaVisual.

import { useState, useEffect } from "react"
import { Pencil, Trash2 } from "lucide-react"
import type { Sector, Mesa, Modo } from "../types"
import MesaVisual from "./MesaVisual"
import ModalEditarSector from "./ModalEditarSector"
import { sectoresApi, extraerDetalle } from "../services/api"
import { DIAMETRO_MESA } from "../constants"
import { useAuth } from "../hooks/useAuth"
import { useAvisoError } from "../hooks/useAvisoError"
import { useArrastre, acotar } from "../hooks/useArrastre"
import { puedeBorrar, puedeEditarLayout } from "../permisos"
import ModalConfirmacion from "./ModalConfirmacion"

// Tamaño mínimo de un sector sin mesas, para evitar que el resize lo colapse a 0.
const TAMANO_MINIMO_SECTOR = 80

interface SectorBloqueProps {
  sector: Sector
  modo: Modo
  anchoSalon: number
  altoSalon: number
  /** Umbral de limpieza demorada, solo de paso hacia MesaVisual (T26-173). */
  umbralLimpiezaMinutos?: number | null
  onMesaClick: (mesa: Mesa) => void
  onMesaPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onSectorDrag: (sectorId: number, pos_x: number, pos_y: number) => void
  onSectorResize: (sectorId: number, ancho: number, alto: number) => void
  onSectorActualizado: (sector: Sector) => void
  onSectorEliminado: (sectorId: number) => void
  onMesaEliminada: (mesaId: number) => void
}

export default function SectorBloque({
  sector,
  modo,
  anchoSalon,
  altoSalon,
  umbralLimpiezaMinutos,
  onMesaClick,
  onMesaPosicionChange,
  onSectorDrag,
  onSectorResize,
  onSectorActualizado,
  onSectorEliminado,
  onMesaEliminada,
}: SectorBloqueProps) {
  // El rol se toma del contexto y no baja por props: SalonCanvas ya pasaba `modo` por dos
  // niveles y sumarle dos booleanos más de permiso habría hecho que cada componente
  // intermedio tuviera que reenviar algo que no usa.
  const { rol } = useAuth()
  // `modo === "edicion"` dice que el salón está en modo armado; esto dice si ESTE usuario
  // puede escribirlo. Son cosas distintas: un mozo no llega al modo edición por la UI,
  // pero si llegara igual no tiene que poder arrastrar nada.
  const puedeEditar = puedeEditarLayout(rol)
  // El error de borrado sube al banner del Dashboard en vez de salir por alert() (T26-200/F-9).
  const avisarError = useAvisoError()

  const [modalEditarAbierto, setModalEditarAbierto] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)

  const [localPos, setLocalPos] = useState({ x: sector.pos_x, y: sector.pos_y })
  const [localSize, setLocalSize] = useState({ ancho: sector.ancho, alto: sector.alto })

  const arrastrePos = useArrastre({
    // Piso en 0 y techo en (dimensión del canvas - dimensión del sector), para que el
    // bloque no pueda arrastrarse fuera de ninguno de los 4 bordes del canvas. El
    // Math.max(0, ...) del techo cubre el caso límite de un sector más grande que el canvas.
    ajustar: (inicial, dx, dy) => ({
      x: acotar(inicial.x + dx, 0, Math.max(0, anchoSalon - sector.ancho)),
      y: acotar(inicial.y + dy, 0, Math.max(0, altoSalon - sector.alto)),
    }),
    onMover: setLocalPos,
    onSoltar: ({ x, y }) => onSectorDrag(sector.id, x, y),
  })

  const arrastreTamano = useArrastre({
    // El mínimo es el espacio que ocupan las mesas activas (para no dejarlas fuera del
    // sector al achicar); el máximo es lo que queda de canvas desde la posición actual
    // del sector (para no sacarlo del canvas al agrandar), igual que el clamp de arriba
    // pero aplicado a tamaño en vez de posición.
    ajustar: (inicial, dx, dy) => {
      const mesasActivas = sector.mesas?.filter((m) => m.activa) ?? []
      const minAncho = mesasActivas.length
        ? Math.max(...mesasActivas.map((m) => m.pos_x + DIAMETRO_MESA))
        : TAMANO_MINIMO_SECTOR
      const minAlto = mesasActivas.length
        ? Math.max(...mesasActivas.map((m) => m.pos_y + DIAMETRO_MESA))
        : TAMANO_MINIMO_SECTOR
      return {
        x: acotar(inicial.x + dx, minAncho, Math.max(minAncho, anchoSalon - sector.pos_x)),
        y: acotar(inicial.y + dy, minAlto, Math.max(minAlto, altoSalon - sector.pos_y)),
      }
    },
    onMover: ({ x, y }) => setLocalSize({ ancho: x, alto: y }),
    onSoltar: ({ x, y }) => onSectorResize(sector.id, x, y),
  })

  useEffect(() => {
    if (!arrastrePos.enCurso()) {
      setLocalPos({ x: sector.pos_x, y: sector.pos_y })
    }
  }, [sector.pos_x, sector.pos_y, arrastrePos])

  useEffect(() => {
    if (!arrastreTamano.enCurso()) {
      setLocalSize({ ancho: sector.ancho, alto: sector.alto })
    }
  }, [sector.ancho, sector.alto, arrastreTamano])

  const handleMouseDown = (e: React.MouseEvent) => {
    // El permiso se chequea en el handler y no solo en el cursor: el arrastre se dispara
    // con un mousedown sobre el bloque entero, no sobre un botón que se pueda esconder.
    // Sin esto, un rol sin permiso arrastraría el sector y recién al soltar se comería el
    // 403 del PATCH, con la posición ya movida en pantalla.
    if (modo !== "edicion" || !puedeEditar) return
    arrastrePos.iniciar(e, { x: sector.pos_x, y: sector.pos_y })
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (modo !== "edicion" || !puedeEditar) return
    e.preventDefault()
    e.stopPropagation()
    arrastreTamano.iniciar(e, { x: localSize.ancho, y: localSize.alto })
  }

  function handleEliminarClick(e: React.MouseEvent) {
    e.stopPropagation()
    setConfirmandoBorrado(true)
  }

  async function eliminar() {
    setEliminando(true)
    try {
      await sectoresApi.actualizar(sector.id, { activo: false })
      setConfirmandoBorrado(false)
      onSectorEliminado(sector.id)
    } catch (err) {
      setConfirmandoBorrado(false)
      avisarError(await extraerDetalle(err, "No se pudo eliminar el sector"))
    } finally {
      setEliminando(false)
    }
  }

  return (
    <>
      <div
        // Ancla estable para los tests: el nombre del sector aparece además en la barra
        // de filtros de SalonCanvas, así que buscarlo por texto matchea dos elementos.
        data-testid={`sector-bloque-${sector.nombre}`}
        style={{
          position: "absolute",
          left: localPos.x,
          top: localPos.y,
          width: localSize.ancho,
          height: localSize.alto,
          border: "2px solid #999",
          backgroundColor: "rgba(255,255,255,0.85)",
          borderRadius: 6,
          boxSizing: "border-box",
          userSelect: "none",
          cursor: modo === "edicion" && puedeEditar ? "grab" : "default",
        }}
        onMouseDown={handleMouseDown}
      >
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 8,
            fontWeight: "bold",
            fontSize: 12,
            color: "#555",
            pointerEvents: "none",
          }}
        >
          {sector.nombre}
        </div>

        {modo === "edicion" && puedeEditar && (
          <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 4, zIndex: 3 }}>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setModalEditarAbierto(true)}
              title="Editar sector"
              style={{
                width: 20,
                height: 20,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #ccc",
                borderRadius: 4,
                backgroundColor: "#fff",
                cursor: "pointer",
              }}
            >
              <Pencil size={12} />
            </button>
            {/* DELETE /sectores/{id} pide admin, a diferencia del PATCH que pide encargado:
                por eso la papelera lleva un gate más estricto que el lápiz de al lado. */}
            {puedeBorrar(rol) && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleEliminarClick}
              disabled={eliminando}
              title="Eliminar sector"
              style={{
                width: 20,
                height: 20,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #ccc",
                borderRadius: 4,
                backgroundColor: "#fff",
                cursor: eliminando ? "default" : "pointer",
                opacity: eliminando ? 0.6 : 1,
              }}
            >
              <Trash2 size={12} />
            </button>
            )}
          </div>
        )}

        {sector.mesas
          ?.filter((m) => m.activa)
          .map((mesa) => (
            <MesaVisual
              key={mesa.id}
              mesa={mesa}
              modo={modo}
              anchoSector={localSize.ancho}
              altoSector={localSize.alto}
              umbralLimpiezaMinutos={umbralLimpiezaMinutos}
              onMesaClick={onMesaClick}
              onPosicionChange={onMesaPosicionChange}
              onMesaEliminada={onMesaEliminada}
            />
          ))}

        {modo === "edicion" && puedeEditar && (
          <div
            onMouseDown={handleResizeMouseDown}
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 12,
              height: 12,
              cursor: "nwse-resize",
              backgroundColor: "#999",
              borderTopLeftRadius: 4,
              zIndex: 3,
            }}
          />
        )}
      </div>

      {modalEditarAbierto && (
        <ModalEditarSector
          sector={sector}
          onClose={() => setModalEditarAbierto(false)}
          onSectorActualizado={(sectorActualizado) => {
            onSectorActualizado(sectorActualizado)
            setModalEditarAbierto(false)
          }}
        />
      )}

      {/* Reemplaza al window.confirm (T26-200/F-10), en el mismo modal que el de edición
          de acá arriba: borrar era la única acción del sector con estética de navegador. */}
      {confirmandoBorrado && (
        <ModalConfirmacion
          titulo="Eliminar sector"
          mensaje={`¿Eliminar el sector "${sector.nombre}"?`}
          etiquetaConfirmar={eliminando ? "Eliminando..." : "Eliminar"}
          ocupado={eliminando}
          onConfirmar={eliminar}
          onCancelar={() => setConfirmandoBorrado(false)}
        />
      )}
    </>
  )
}
