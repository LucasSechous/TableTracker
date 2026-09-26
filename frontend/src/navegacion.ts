// Tabla de secciones de la aplicación: la única fuente de la navegación (T26-205).
//
// Antes la navegación vivía dentro de MenuLateral como diez botones escritos a mano, y el
// título de cada pantalla como un <h1> literal en el archivo de esa pantalla. Eran dos
// listas de lo mismo que nadie obligaba a coincidir: agregar una sección pedía tocar el
// menú, el <h1> y App.tsx, y olvidarse de uno no rompía la compilación.
//
// Acá viven la ruta, la etiqueta, el icono, el grupo y si pide rol admin. El menú recorre
// esta tabla y el encabezado busca en ella el título de la ruta actual, así que una
// sección nueva aparece en los dos lugares o en ninguno.
//
// `soloAdmin` NO es un control de acceso: el que manda es el backend, y del lado del
// router lo hace <AdminRoute>. Acá sirve para no ofrecer en el menú una sección que va a
// rebotar, que es el mismo criterio de permisos.ts.

import {
  BarChart3,
  CalendarClock,
  Camera,
  Crosshair,
  History,
  LayoutGrid,
  PieChart,
  Repeat,
  Settings,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export type GrupoSeccion = "operacion" | "metricas" | "administracion"

export interface Seccion {
  ruta: string
  etiqueta: string
  icono: LucideIcon
  grupo: GrupoSeccion
  /** Si la ruta está detrás de <AdminRoute> en App.tsx. */
  soloAdmin: boolean
}

// El orden es el del menú: primero lo que se usa durante el servicio, después lo que se
// consulta, y al final lo que se configura una vez y no se toca más.
export const SECCIONES: Seccion[] = [
  { ruta: "/", etiqueta: "Salón", icono: LayoutGrid, grupo: "operacion", soloAdmin: false },
  { ruta: "/historial", etiqueta: "Historial de mesas", icono: History, grupo: "operacion", soloAdmin: false },

  { ruta: "/ocupacion", etiqueta: "Ocupación del salón", icono: PieChart, grupo: "metricas", soloAdmin: false },
  { ruta: "/rotacion", etiqueta: "Rotación de mesas", icono: Repeat, grupo: "metricas", soloAdmin: false },
  { ruta: "/ocupacion-diaria", etiqueta: "Ocupación diaria", icono: CalendarClock, grupo: "metricas", soloAdmin: false },
  { ruta: "/demanda", etiqueta: "Horarios de demanda", icono: BarChart3, grupo: "metricas", soloAdmin: false },

  { ruta: "/camaras", etiqueta: "Cámaras", icono: Camera, grupo: "administracion", soloAdmin: true },
  { ruta: "/calibracion-roi", etiqueta: "Calibración de ROI", icono: Crosshair, grupo: "administracion", soloAdmin: true },
  { ruta: "/configuracion", etiqueta: "Configuración", icono: Settings, grupo: "administracion", soloAdmin: true },
  { ruta: "/usuarios", etiqueta: "Usuarios", icono: Users, grupo: "administracion", soloAdmin: true },
]

// Rótulo de cada grupo en el menú. Las cuatro vistas de métricas agrupadas se leen como
// una sola cosa ("¿cómo viene el negocio?") en vez de como cuatro entradas sueltas que hay
// que saber distinguir de antemano.
export const TITULO_GRUPO: Record<GrupoSeccion, string> = {
  operacion: "Operación",
  metricas: "Métricas",
  administracion: "Administración",
}

export const GRUPOS: GrupoSeccion[] = ["operacion", "metricas", "administracion"]

/**
 * Sección que corresponde a una ruta, o el salón si no hay ninguna.
 *
 * El fallback no es un descuido: en App.tsx la ruta comodín `/*` renderiza el salón, así
 * que una ruta desconocida muestra el salón y el encabezado tiene que decir lo mismo que
 * se está viendo. Devolver undefined dejaría el título vacío en esa pantalla.
 */
export function seccionDe(pathname: string): Seccion {
  return SECCIONES.find((s) => s.ruta === pathname) ?? SECCIONES[0]
}
