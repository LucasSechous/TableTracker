// Representación visual de una mesa como círculo coloreado sobre el canvas del salón.
// En modo monitoreo el click abre PanelMesa con el detalle; en modo edición es arrastrable.

import { useState, useEffect } from "react"
import { Trash2 } from "lucide-react"
import type { Mesa, Modo } from "../types"
import { mesasApi, extraerDetalle } from "../services/api"
import {
  DIAMETRO_MESA,
  COLOR_POR_ESTADO,
  BORDE_POR_ESTADO,
  COLOR_LIMPIEZA_DEMORADA,
  COLOR_ESTADO_DUDOSO,
  limpiezaDemorada,
  minutosEnEstado,
} from "../constants"
import { useAuth } from "../hooks/useAuth"
import { useAvisoError } from "../hooks/useAvisoError"
import { useArrastre, acotar } from "../hooks/useArrastre"
import { puedeBorrar, puedeEditarLayout } from "../permisos"
import ModalConfirmacion from "./ModalConfirmacion"

interface MesaVisualProps {
  mesa: Mesa
  modo: Modo
  anchoSector: number
  altoSector: number
  /** Umbral de limpieza demorada en minutos, o null si la alerta está apagada (T26-173). */
  umbralLimpiezaMinutos?: number | null
  onMesaClick: (mesa: Mesa) => void
  onPosicionChange: (mesaId: number, pos_x: number, pos_y: number) => void
  onMesaEliminada: (mesaId: number) => void
}

export default function MesaVisual({
  mesa,
  modo,
  anchoSector,
  altoSector,
  umbralLimpiezaMinutos,
  onMesaClick,
  onPosicionChange,
  onMesaEliminada,
}: MesaVisualProps) {
  // Mismo criterio que SectorBloque: el rol se lee del contexto en vez de bajarlo por
  // props a través de SalonCanvas y SectorBloque, que no lo usan para nada propio.
  const { rol } = useAuth()
  const puedeEditar = puedeEditarLayout(rol)
  // El error de borrado sube al banner del Dashboard en vez de salir por alert() (T26-200/F-9).
  const avisarError = useAvisoError()

  const [eliminando, setEliminando] = useState(false)
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)
  const [localPos, setLocalPos] = useState({ x: mesa.pos_x, y: mesa.pos_y })

  const arrastre = useArrastre({
    // Piso en 0 y techo en (dimensión del sector - diámetro de la mesa), para que el
    // círculo no pueda arrastrarse fuera de ninguno de los 4 bordes del sector. El
    // Math.max(0, ...) del techo cubre el caso límite de un sector más chico que la mesa.
    ajustar: (inicial, dx, dy) => ({
      x: acotar(inicial.x + dx, 0, Math.max(0, anchoSector - DIAMETRO_MESA)),
      y: acotar(inicial.y + dy, 0, Math.max(0, altoSector - DIAMETRO_MESA)),
    }),
    onMover: setLocalPos,
    onSoltar: ({ x, y }) => onPosicionChange(mesa.id, x, y),
  })

  useEffect(() => {
    if (!arrastre.enCurso()) {
      setLocalPos({ x: mesa.pos_x, y: mesa.pos_y })
    }
  }, [mesa.pos_x, mesa.pos_y, arrastre])

  const handleMouseDown = (e: React.MouseEvent) => {
    // Igual que en SectorBloque: el arrastre nace de un mousedown sobre la mesa, así que
    // esconder botones no alcanza. Sin este chequeo un rol sin permiso movería la mesa y
    // el 403 del PATCH /mesas/{id}/posicion llegaría recién al soltarla.
    if (modo !== "edicion" || !puedeEditar) return
    e.preventDefault()
    e.stopPropagation()
    arrastre.iniciar(e, localPos)
  }

  const handleClick = (e: React.MouseEvent) => {
    if (modo !== "monitoreo") return
    e.stopPropagation()
    onMesaClick(mesa)
  }

  function handleEliminarClick(e: React.MouseEvent) {
    e.stopPropagation()
    setConfirmandoBorrado(true)
  }

  async function eliminar() {
    setEliminando(true)
    try {
      await mesasApi.desactivar(mesa.id)
      setConfirmandoBorrado(false)
      onMesaEliminada(mesa.id)
    } catch (err) {
      // El modal se cierra igual: el mensaje va al banner del salón, que se lee sin tener
      // el diálogo encima tapando la mesa de la que está hablando.
      setConfirmandoBorrado(false)
      avisarError(await extraerDetalle(err, "No se pudo eliminar la mesa"))
    } finally {
      setEliminando(false)
    }
  }

  // El aviso solo tiene sentido mirando el salón en vivo: en modo edición el canvas es
  // para acomodar mesas, y un badge rojo ahí compite con los controles de arrastre.
  const atrasada =
    modo === "monitoreo" && limpiezaDemorada(mesa.estado, mesa.estado_desde, umbralLimpiezaMinutos)
  const minutosAtraso = atrasada ? minutosEnEstado(mesa.estado_desde) : null

  // Estado dudoso (T26-188, RF-27). Solo en monitoreo, igual que el aviso de arriba.
  //
  // Se lee tal cual del backend en vez de recalcularlo: el criterio necesita la hora de
  // cierre del local y saber qué mesas tienen ROI activo en cámara activa, y ninguna de las
  // dos cosas está en este componente.
  //
  // No puede coexistir con `atrasada`: aquella exige pendiente_limpieza y esta exige
  // ocupada, así que los dos badges nunca compiten por el mismo lugar. Aun así el borde se
  // resuelve con un if ordenado y no con dos ternarios anidados, para que agregar una
  // tercera condición en el futuro no dependa de que sigan siendo excluyentes.
  const dudosa = modo === "monitoreo" && mesa.estado_dudoso === true

  const colorBorde = atrasada
    ? COLOR_LIMPIEZA_DEMORADA
    : dudosa
      ? COLOR_ESTADO_DUDOSO
      : BORDE_POR_ESTADO[mesa.estado] ?? "#757575"

  return (
    <div style={{ position: "absolute", left: localPos.x, top: localPos.y }}>
      <div
        // Ancla estable para los tests. Antes se ubicaba por el border-radius del 50%
        // que tenía cuando las mesas se dibujaban redondas; ahora son cuadradas y ese
        // selector dejó de encontrar nada.
        data-testid={`mesa-${mesa.numero}`}
        style={{
          width: DIAMETRO_MESA,
          height: DIAMETRO_MESA,
          borderRadius: 8,
          // El relleno NO cambia: sigue siendo el naranja de pendiente_limpieza, porque
          // el estado no cambió. Lo que se refuerza es el borde, que es la capa que
          // puede señalar una condición sin pisar la lectura del estado.
          border: `${atrasada || dudosa ? 3 : 2}px solid ${colorBorde}`,
          backgroundColor: COLOR_POR_ESTADO[mesa.estado] ?? "#9e9e9e",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "bold",
          fontSize: 16,
          cursor: modo === "edicion" && puedeEditar ? "grab" : "pointer",
          userSelect: "none",
          position: "relative",
          zIndex: 2,
        }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        {mesa.numero}
      </div>

      {atrasada && minutosAtraso !== null && (
        <div
          data-testid={`mesa-${mesa.numero}-limpieza-demorada`}
          title={`Pendiente de limpieza hace ${minutosAtraso} minutos`}
          style={{
            position: "absolute",
            top: -8,
            left: DIAMETRO_MESA - 16,
            minWidth: 26,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            backgroundColor: COLOR_LIMPIEZA_DEMORADA,
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // Por encima de la mesa pero por debajo del botón de eliminar (z 3), que en
            // modo edición no coexiste con esto de todos modos.
            zIndex: 3,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {minutosAtraso}m
        </div>
      )}

      {/* Estado dudoso (T26-188, RF-27). Mismo anclaje y tamaño que el badge de arriba —no
          pueden aparecer juntos, ver el comentario de `dudosa`—. El contenido es un signo
          de pregunta y no un número porque acá no hay una magnitud que mostrar: lo que se
          comunica es que el dato no es confiable, no cuánto lleva así. El detalle va en el
          title, que es donde el usuario puede leer el motivo sin llenar el canvas. */}
      {dudosa && (
        <div
          data-testid={`mesa-${mesa.numero}-estado-dudoso`}
          title="Figura ocupada con el local cerrado: puede ser un error de detección"
          style={{
            position: "absolute",
            top: -8,
            left: DIAMETRO_MESA - 16,
            minWidth: 26,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            backgroundColor: COLOR_ESTADO_DUDOSO,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          ?
        </div>
      )}

      {/* DELETE /mesas/{id} pide admin, no encargado: por eso acá va puedeBorrar y no
          puedeEditar, aunque el botón viva dentro del mismo modo edición. */}
      {modo === "edicion" && puedeBorrar(rol) && (
        <button
          // Por número de mesa y no solo por el title: el title alcanzaba mientras nadie
          // clickeara el botón, pero un sector con varias mesas tiene varios botones
          // idénticos y el locator se vuelve ambiguo (T26-200, spec 24).
          data-testid={`mesa-${mesa.numero}-eliminar`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleEliminarClick}
          disabled={eliminando}
          title="Eliminar mesa"
          style={{
            position: "absolute",
            top: -6,
            left: 44,
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
            zIndex: 3,
          }}
        >
          <Trash2 size={12} />
        </button>
      )}

      {/* Reemplaza al window.confirm (T26-200/F-10). Se dibuja desde acá aunque la mesa viva
          dentro del canvas: el overlay es position:fixed y no hay ningún transform en la
          cadena de ancestros, así que cubre la ventana entera y no queda recortado por el
          overflow:hidden del salón. */}
      {confirmandoBorrado && (
        <ModalConfirmacion
          titulo="Eliminar mesa"
          mensaje={`¿Eliminar la mesa ${mesa.numero}?`}
          etiquetaConfirmar={eliminando ? "Eliminando..." : "Eliminar"}
          ocupado={eliminando}
          onConfirmar={eliminar}
          onCancelar={() => setConfirmandoBorrado(false)}
        />
      )}
    </div>
  )
}
