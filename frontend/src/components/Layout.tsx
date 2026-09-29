// Marco común de las pantallas autenticadas (T26-205): encabezado fijo + menú lateral.
//
// Hasta ahora cada pantalla escribía su propio <header>: el mismo bloque de nueve líneas,
// copiado diez veces, con un <h1> literal y un botón "Volver al salón". El menú lo montaba
// solo el Dashboard, así que desde las demás no había forma de ir a ningún lado sin pasar
// antes por el salón.
//
// Al vivir el encabezado acá, el menú viene con él: cualquier pantalla envuelta en Layout
// tiene la navegación completa, y el título sale de la tabla de navegacion.ts en vez de
// estar escrito a mano, así que no puede decir una cosa distinta de la que muestra el menú.
//
// El encabezado es position:fixed para las diez pantallas y no solo para el salón. Lo
// descubrió el Dashboard —con un salón grande el encabezado se iba con el scroll— pero
// vale igual en las tablas largas de Historial o Usuarios, y hace que la barra no salte de
// lugar al cambiar de sección.

import { useState } from "react"
import type { ReactNode } from "react"
import { Menu } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import MenuLateral from "./MenuLateral"
import { seccionDe } from "../navegacion"

// Con altura fija se puede compensar el encabezado con un spacer del mismo tamaño en vez
// de medirlo en runtime.
export const ALTURA_HEADER = 68

interface Props {
  children: ReactNode
  /**
   * Acciones propias de la pantalla, a la izquierda del botón de menú. Van acá y no
   * dentro del contenido para que queden siempre visibles junto con el encabezado.
   */
  acciones?: ReactNode
  /** Título alternativo. Por defecto, el de la sección según la ruta actual. */
  titulo?: string
}

export default function Layout({ children, acciones, titulo }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  // El logo es un archivo suelto en public/. Si falta, el encabezado no puede quedar
  // con un icono roto: se cae al nombre escrito, que es como se veía antes.
  const [logoRoto, setLogoRoto] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const seccion = seccionDe(pathname)

  return (
    <div className="min-h-[100vh] bg-gris-75">
      <header
        className="app-header"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 150,
          height: ALTURA_HEADER,
          backgroundColor: "var(--color-blanco)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          boxSizing: "border-box",
        }}
      >
        {/* Logo a la izquierda y el nombre de la sección a su derecha. Los dos en una fila
            y no apilados como antes: el logo ya dice el nombre del producto, así que
            repetirlo arriba del título sería decirlo dos veces.

            La marca es el camino de vuelta al salón desde cualquier lado, que es lo que
            hacía el botón "Volver al salón" de cada pantalla. Sigue estando además como
            primera entrada del menú: acá es el atajo, allá el destino explícito. */}
        <div className="flex items-center gap-[12px] min-w-[0px]">
          <button
            onClick={() => navigate("/")}
            title="Ir al salón"
            className="border-0 bg-[none] p-[0px] cursor-pointer shrink-0 flex items-center"
          >
            {logoRoto ? (
              // Si el archivo del logo no está, en vez de un icono roto se cae al nombre
              // escrito, que es como se veía antes de tener logo.
              <span className="text-[13px] font-bold tracking-[0.5px] text-slate-400">TABLETRACKER</span>
            ) : (
              <img
                src="/logo-icono.png"
                alt="TableTracker"
                onError={() => setLogoRoto(true)}
                className="h-[40px] w-auto block"
              />
            )}
          </button>

          {/* El separador solo existe cuando hay logo: sin él, el nombre escrito y el
              título quedarían pegados sin nada que los distinga. */}
          <span aria-hidden className="text-[20px] text-slate-300 shrink-0 font-[300]">
            /
          </span>

          <h1
            className="text-[18px] font-bold text-gris-900 m-[0px] overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {titulo ?? seccion.etiqueta}
          </h1>
        </div>

        <div className="flex items-center gap-[8px] shrink-0">
          {acciones}
          <button
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            aria-expanded={menuAbierto}
            className="w-[44px] h-[44px] shrink-0 border-0 rounded-[10px] bg-slate-100 text-gris-900 cursor-pointer flex items-center justify-center"
          >
            <Menu size={20} aria-hidden />
          </button>
        </div>
      </header>

      {/* Compensa el encabezado fijo: sin esto el contenido arrancaría tapado. */}
      <div style={{ height: ALTURA_HEADER }} />

      {children}

      <MenuLateral abierto={menuAbierto} onClose={() => setMenuAbierto(false)} />
    </div>
  )
}
