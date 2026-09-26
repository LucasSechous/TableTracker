// Confirmación de una acción destructiva, en el mismo modal que usa el resto de la app
// (T26-200/F-10).
//
// Reemplaza a window.confirm. El proyecto ya mantenía cinco modales propios para altas y
// ediciones, así que las acciones destructivas —borrar una mesa, un sector, una zona de ROI,
// desactivar una cámara o un usuario— eran justo las únicas con estética de navegador. Además
// window.confirm bloquea el hilo y, en Playwright, obliga a interceptar el diálogo nativo en
// vez de clickear un botón como en cualquier otro flujo.
//
// Es presentacional a propósito: quien lo usa mantiene su propio estado de "pendiente de
// confirmar" y decide cuándo cerrarlo. Así el efecto de confirmar (que casi siempre es una
// llamada a la API con su propio manejo de error) queda del lado que sabe qué hacer con él.

import Modal from "./Modal"

interface Props {
  /** Encabezado corto: qué se va a hacer. */
  titulo: string
  /** La pregunta completa, con el nombre o número del recurso. */
  mensaje: string
  /** Texto del botón rojo. Debe nombrar la acción ("Eliminar", "Desactivar"), no decir "Sí". */
  etiquetaConfirmar: string
  onConfirmar: () => void
  onCancelar: () => void
  /** La acción ya está en curso: bloquea los dos botones para no dispararla dos veces. */
  ocupado?: boolean
  /**
   * Botón primario en rojo. Es el default porque casi todo lo que se confirma acá destruye
   * algo; se apaga para el caso simétrico que no lo hace (reactivar un usuario), donde el
   * rojo estaría avisando de un peligro que no existe.
   */
  peligroso?: boolean
}

export default function ModalConfirmacion({
  titulo,
  mensaje,
  etiquetaConfirmar,
  onConfirmar,
  onCancelar,
  ocupado = false,
  peligroso = true,
}: Props) {
  return (
    <Modal
      titulo={titulo}
      etiquetaConfirmar={etiquetaConfirmar}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
      ocupado={ocupado}
      peligroso={peligroso}
    >
      <p style={{ fontSize: 14, color: "#444", margin: "0 0 20px", lineHeight: 1.5 }}>{mensaje}</p>
    </Modal>
  )
}
