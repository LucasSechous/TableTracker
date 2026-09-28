// Overlay + caja centrada, compartidos por todos los modales de alta y edición (T26-200/F-3).
//
// Los cinco modales del proyecto declaraban por su cuenta el mismo bloque `position: fixed`,
// la misma caja blanca, el mismo <h2>, el mismo banner de error y el mismo par de botones al
// pie. Cinco copias es la cantidad justa para que un cambio de z-index o de accesibilidad se
// aplique bien en cuatro y mal en una. Acá vive todo eso; cada modal conserva solo su
// formulario y el texto de su botón primario.
//
// CSS plano inline y sin librerías de UI, igual que el resto del frontend.

import type { ReactNode } from "react"

interface Props {
  /** Va en un <h2>: los tests lo ubican por rol heading (ej. "Editar cámara"). */
  titulo: string
  onCancelar: () => void
  onConfirmar: () => void
  /** Texto del botón primario. Lo arma el llamador porque también expresa el progreso ("Creando..."). */
  etiquetaConfirmar: string
  children: ReactNode
  /** Mensaje de error arriba del formulario. null u omitido no dibuja nada. */
  error?: string | null
  /**
   * Ancho de la caja. Los modales de cámara usan 380 porque su formulario tiene la URL RTSP;
   * los de mesa y sector entran en el default.
   */
  ancho?: number
  /**
   * Hay una operación en curso: deshabilita los DOS botones. Cancelar también, porque a
   * mitad de un POST no hay nada que cancelar y cerrar dejaría el resultado sin aplicar.
   */
  ocupado?: boolean
  /**
   * Deshabilita solo el botón primario, sin tocar Cancelar. Es para cuando el formulario no
   * se puede enviar por una razón propia (ModalAltaCamara sin sectores creados), caso en el
   * que salir sí es una acción válida.
   */
  confirmarDeshabilitado?: boolean
  /**
   * Pinta el botón primario de rojo. Para acciones destructivas (ver ModalConfirmacion): el
   * azul de "Guardar" no distingue confirmar una edición de confirmar un borrado.
   */
  peligroso?: boolean
}

export default function Modal({
  titulo,
  onCancelar,
  onConfirmar,
  etiquetaConfirmar,
  children,
  error,
  ancho = 360,
  ocupado = false,
  confirmarDeshabilitado = false,
  peligroso = false,
}: Props) {
  const primarioBloqueado = ocupado || confirmarDeshabilitado

  return (
    <div
      // El modal es hijo de quien lo abre, y eso a veces lo deja DENTRO de un elemento que
      // escucha el mouse: el de confirmación de MesaVisual cuelga del bloque del sector, que
      // en modo edición arranca a arrastrarse con cualquier mousedown que le llegue. Sin esto,
      // apretar "Eliminar" iniciaría un drag del sector por debajo del modal y dispararía un
      // PATCH de posición al soltar. Lo que pasa acá adentro no es asunto de lo que hay detrás.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-[0px] bg-[rgba(0,0,0,0.5)] flex items-center justify-center z-[1000]"
    >
      <div
        data-testid="modal"
        style={{
          backgroundColor: "var(--color-blanco)",
          borderRadius: 8,
          padding: 24,
          width: ancho,
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        }}
      >
        <h2 className="text-[16px] font-bold text-gris-900 mt-[0] mx-[0] mb-[16px]">{titulo}</h2>

        {error && (
          <p
            data-testid="modal-error"
            className="text-[13px] text-error bg-error-fondo border border-error-borde rounded-[6px] py-[8px] px-[12px] mt-[0] mx-[0] mb-[12px]"
          >
            {error}
          </p>
        )}

        {children}

        <div className="flex justify-end gap-[8px]">
          <button
            data-testid="modal-cancelar"
            onClick={onCancelar}
            disabled={ocupado}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--color-gris-250)",
              fontSize: 13,
              cursor: ocupado ? "default" : "pointer",
              backgroundColor: "var(--color-blanco)",
              color: "var(--color-gris-600)",
              fontWeight: 500,
            }}
          >
            Cancelar
          </button>
          <button
            data-testid="modal-confirmar"
            onClick={onConfirmar}
            disabled={primarioBloqueado}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 13,
              cursor: primarioBloqueado ? "default" : "pointer",
              backgroundColor: peligroso ? "var(--color-error)" : "var(--color-marca)",
              color: "var(--color-blanco)",
              fontWeight: 500,
              opacity: primarioBloqueado ? 0.6 : 1,
            }}
          >
            {etiquetaConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
