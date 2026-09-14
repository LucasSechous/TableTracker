// Canal para que los componentes del canvas reporten un error de acción hacia el banner de
// la pantalla que los contiene (T26-200/F-9).
//
// Antes esos errores salían por alert(): un diálogo modal del navegador, justo en el flujo de
// uso continuo (mover una mesa, cambiarle el estado, borrar un sector) donde más interrumpe, y
// además invisible para los tests salvo interceptando el diálogo nativo. El resto de la app ya
// mostraba sus errores en un banner in-page con setError; esto es lo que le faltaba al canvas
// para poder hacer lo mismo.
//
// Va por contexto y no por props por la misma razón por la que el rol va por contexto (T26-194):
// MesaVisual cuelga de SectorBloque, que cuelga de SalonCanvas, y ninguno de los dos
// intermediarios tiene nada que hacer con el mensaje. Bajarlo por props sería reintroducir
// exactamente el prop drilling que F-12 marca como problema.
//
// El estado del mensaje NO vive acá: lo tiene la pantalla, que es la que dibuja el banner y
// decide dónde. Este módulo solo transporta la función de avisar.

import { createContext, useContext, type ReactNode } from "react"

/** Muestra un error de acción. El llamador ya resolvió el texto (ver extraerDetalle). */
type Avisar = (mensaje: string) => void

const AvisoErrorContext = createContext<Avisar | undefined>(undefined)

export function AvisoErrorProvider({ avisar, children }: { avisar: Avisar; children: ReactNode }) {
  return <AvisoErrorContext.Provider value={avisar}>{children}</AvisoErrorContext.Provider>
}

export function useAvisoError(): Avisar {
  const avisar = useContext(AvisoErrorContext)
  if (!avisar) {
    // Mismo criterio que useAuth(): romper fuerte y temprano. Un no-op por defecto dejaría
    // que un error de la API se perdiera en silencio, que es peor que el alert() que esto vino
    // a reemplazar.
    throw new Error("useAvisoError() tiene que usarse dentro de <AvisoErrorProvider>")
  }
  return avisar
}
