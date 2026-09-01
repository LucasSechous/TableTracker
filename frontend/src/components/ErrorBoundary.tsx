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
        style={{
          minHeight: "100vh",
          backgroundColor: "#f5f5f5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            padding: 24,
            maxWidth: 520,
            width: "100%",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
            Se rompió esta pantalla
          </h1>
          <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.5, margin: "0 0 16px" }}>
            Hubo un error inesperado al dibujar la página. Los datos no se perdieron: podés
            recargar y seguir trabajando.
          </p>

          {/* El mensaje crudo se muestra plegado: no le sirve a un mozo, pero es lo primero
              que se necesita para reportar el problema o depurarlo. */}
          <details style={{ marginBottom: 16 }}>
            <summary style={{ fontSize: 13, color: "#64748b", cursor: "pointer" }}>
              Detalle técnico
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 12,
                color: "#334155",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {this.state.error.message}
            </pre>
          </details>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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

const estiloBoton: React.CSSProperties = {
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 6,
  border: "1px solid #1976d2",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  backgroundColor: "#fff",
  color: "#1976d2",
}

const estiloBotonPrimario: React.CSSProperties = {
  ...estiloBoton,
  border: "none",
  backgroundColor: "#1976d2",
  color: "#fff",
  fontWeight: 600,
}
