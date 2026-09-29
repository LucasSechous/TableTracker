// Red de seguridad ante errores de render.
//
// React desmonta TODO el árbol cuando una excepción sube sin que nadie la atrape, y sin un
// boundary eso se ve como una página en blanco: ni mensaje, ni forma de volver, ni pista de
// qué pasó. Es lo que ocurría al guardar una cámara con un error de validación (el detail de
// un 422 es una lista de objetos y terminaba renderizándose como hijo de React).
//
// La causa puntual está arreglada en services/api.ts, pero eso corrige UN caso. Esto cubre
// la clase entera: cualquier excepción de render futura muestra algo accionable en vez de
// dejar la aplicación muda.
//
// Tiene que ser un componente de clase: getDerivedStateFromError y componentDidCatch no
// existen como hooks.

import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Queda en la consola con el stack de componentes, que es lo que sirve para ubicar el
    // origen. No se manda a ningún lado: el proyecto no tiene servicio de reporte de errores.
    console.error("Error de render no controlado:", error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        className="min-h-[100vh] bg-gris-75 flex items-center justify-center p-[24px]"
      >
        <div
          className="bg-blanco border border-gris-200 rounded-[8px] p-[24px] max-w-[520px] w-full"
        >
          <h1 className="text-[18px] font-bold text-gris-900 mt-[0] mx-[0] mb-[8px]">
            Se rompió esta pantalla
          </h1>
          <p className="text-[14px] text-slate-600 leading-[1.5] mt-[0] mx-[0] mb-[16px]">
            Hubo un error inesperado al dibujar la página. Los datos no se perdieron: podés
            recargar y seguir trabajando.
          </p>

          {/* El mensaje crudo se muestra plegado: no le sirve a un mozo, pero es lo primero
              que se necesita para reportar el problema o depurarlo. */}
          <details className="mb-[16px]">
            <summary className="text-[13px] text-slate-500 cursor-pointer">
              Detalle técnico
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                backgroundColor: "var(--color-slate-50)",
                border: "1px solid var(--color-slate-200)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--color-slate-700)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {this.state.error.message}
            </pre>
          </details>

          <div className="flex gap-[10px] flex-wrap">
            {/* Recarga completa a propósito: después de un error de render el estado en
                memoria quedó a medio camino y no es confiable para seguir usándolo. */}
            <button onClick={() => window.location.reload()} style={estiloBotonPrimario}>
              Recargar la página
            </button>
            <button onClick={() => (window.location.href = "/")} style={estiloBoton}>
              Volver al salón
            </button>
          </div>
        </div>
      </div>
    )
  }
}

// Los dos únicos estilos de botón que sobrevivieron a T26-205, y a propósito: esta pantalla
// es la que se dibuja cuando el árbol de React ya se rompió. Si usara <Boton> y el fallo
// viniera de ahí —o de cualquier cosa que Boton importe— la pantalla de error se caería
// junto con la aplicación y el usuario se quedaría mirando una página en blanco. Un
// boundary vale lo que valen sus dependencias, así que acá no tiene ninguna.
const estiloBoton: React.CSSProperties = {
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 6,
  border: "1px solid var(--color-marca)",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  backgroundColor: "var(--color-blanco)",
  color: "var(--color-marca)",
}

const estiloBotonPrimario: React.CSSProperties = {
  ...estiloBoton,
  border: "none",
  backgroundColor: "var(--color-marca)",
  color: "var(--color-blanco)",
  fontWeight: 600,
}
