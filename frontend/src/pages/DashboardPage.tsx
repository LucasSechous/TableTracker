// Panel principal de TableTracker con canvas 2D del salón del restaurante.
// Carga mesas y sectores, los agrupa, y orquesta los cambios de estado y posición.

import { useEffect, useRef, useState } from "react"
import { Pencil, TriangleAlert } from "lucide-react"
import { mesasApi, sectoresApi, configuracionApi, metricasApi, extraerDetalle } from "../services/api"
import type { Mesa, Sector, Modo, Configuracion, OcupacionResponse } from "../types"
import SalonCanvas from "../components/SalonCanvas"
import ModalAltaSector from "../components/ModalAltaSector"
import ModalAltaMesa from "../components/ModalAltaMesa"
import Layout from "../components/Layout"
import IndicadorFrescura from "../components/IndicadorFrescura"
import Boton from "../components/ui/Boton"
import AvisoReservaDetectada from "../components/AvisoReservaDetectada"
import { useAuth } from "../hooks/useAuth"
import { AvisoErrorProvider } from "../hooks/useAvisoError"
import { puedeEditarLayout, puedeReservar } from "../permisos"
import { labelStyle } from "../components/RangoFechas"
import { COLOR_OCUPACION_ALTA, ETIQUETA_POR_ESTADO } from "../constants"

// Cada cuánto se refresca el estado de las mesas en modo monitoreo, para reflejar
// los cambios que escribe vision-module sin que alguien tenga que recargar la
// página. 3s da margen de sobra frente a los 6s de CONFIRMACION_SEGUNDOS por
// defecto del módulo de visión (docs/vision-loop.md): el cambio nunca tarda más
// de un intervalo en aparecer una vez confirmado.
const INTERVALO_REFRESCO_MESAS_MS = 3000

// Opciones del filtro por estado (RF-15). Se derivan de ETIQUETA_POR_ESTADO en vez de
// repetir los cuatro pares acá: ese mapa ya es la fuente de las etiquetas que el usuario
// ve en el canvas y en el panel de mesa, y duplicarlo abriría la puerta a que el filtro
// diga "Pendiente de limpieza" y la mesa diga otra cosa. El orden de las claves del
// objeto es el de inserción (libre, ocupada, pendiente_limpieza, reservada), que es el
// que corresponde al ciclo de vida de una mesa.
const OPCIONES_ESTADO = Object.entries(ETIQUETA_POR_ESTADO)

// Valor del filtro que significa "no filtrar". Cadena vacía y no null para poder usarlo
// tal cual como value del <option>, igual que hacen los filtros de Historial y Rotación.
const SIN_FILTRO = ""

export default function DashboardPage() {
  // El rol sale del contexto y no de un authApi.me() propio: es la misma respuesta que ya
  // resolvió AuthProvider una vez para todo el árbol. El nombre del usuario ya no se lee
  // acá: lo muestra el menú lateral, que desde T26-205 lo toma del contexto por su cuenta.
  const { rol } = useAuth()
  const [sectores, setSectores] = useState<Sector[]>([])
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Aparte de `error` a propósito (T26-200/F-9): aquel es un fallo de CARGA y deja la
  // pantalla sin salón, este es el fallo de una acción puntual sobre un salón que sigue
  // dibujado y usable. Meterlos en el mismo estado haría que un error al mover una mesa
  // desmontara el canvas entero, porque el render del canvas está condicionado a `!error`.
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>("monitoreo")
  const [modalAbierto, setModalAbierto] = useState<"sector" | "mesa" | null>(null)
  // Filtro por estado (RF-15). Se resuelve contra el backend (GET /mesas?estado=...), no
  // recortando el array en el cliente: el endpoint ya lo soporta y así el canvas no
  // recibe mesas que no va a dibujar.
  const [estadoFiltro, setEstadoFiltro] = useState<string>(SIN_FILTRO)
  // Alerta de alta ocupación (T26-187, RF-26). Sale de GET /metricas/ocupacion y NO se
  // calcula acá a partir de `sectores`, aunque a primera vista alcanzaría: ese array está
  // recortado por estadoFiltro, así que con un filtro puesto el porcentaje que saldría de
  // contarlo sería el del subconjunto visible y no el del salón. Con filtro "libre" daría
  // 0% de ocupación y la alerta se apagaría justo cuando el salón está lleno.
  //
  // Es una request más por ciclo de refresco, a diferencia de la alerta de limpieza
  // demorada (T26-173), que se resuelve con la configuración ya cargada. La diferencia es
  // esa: aquella depende de datos que el canvas ya tiene (estado y reloj de cada mesa),
  // esta depende del total del salón, que el canvas filtrado no conoce.
  const [ocupacion, setOcupacion] = useState<OcupacionResponse | null>(null)
  // Bloquea los botones del aviso de reserva mientras va una de las dos acciones, para
  // que un doble clic no mande dos veces la misma decisión.
  const [resolviendoReserva, setResolviendoReserva] = useState(false)
  // Momento del último refresco que SÍ trajo datos, para poder decir en pantalla qué tan
  // viejo es lo que se está mirando. Se guarda el éxito y no el intento: un intento que
  // falló no rejuvenece el dato, y contarlo sería justo lo contrario de lo que esto mide.
  const [ultimoRefrescoOk, setUltimoRefrescoOk] = useState<number | null>(null)
  // El spinner de "Cargando salón..." solo tiene sentido la primera vez. Al cambiar el
  // filtro el canvas ya está dibujado, y desmontarlo por unos milisegundos se ve como un
  // parpadeo del salón entero.
  const yaCargoUnaVez = useRef(false)

  useEffect(() => {
    if (!yaCargoUnaVez.current) setLoading(true)
    setError(null)
    Promise.all([
      mesasApi.listar(estadoFiltro ? { estado: estadoFiltro } : undefined),
      sectoresApi.listar(),
      configuracionApi.obtener(),
    ])
      .then(([mesasRes, sectoresRes, configuracionRes]) => {
        const mesas: Mesa[] = mesasRes.data
        const rawSectores: Sector[] = sectoresRes.data
        const mesasBySector = new Map<number, Mesa[]>()
        mesas.forEach((m) => {
          const arr = mesasBySector.get(m.sector.id) ?? []
          arr.push(m)
          mesasBySector.set(m.sector.id, arr)
        })
        setSectores(
          rawSectores.map((s) => ({ ...s, mesas: mesasBySector.get(s.id) ?? [] }))
        )
        setConfiguracion(configuracionRes.data)
        setUltimoRefrescoOk(Date.now())
      })
      .catch(async (err: unknown) => {
        setError(await extraerDetalle(err, "Error al cargar el salón"))
      })
      .finally(() => {
        yaCargoUnaVez.current = true
        setLoading(false)
      })
  }, [estadoFiltro])

  // Solo en monitoreo: en modo edición el usuario puede estar arrastrando una mesa
  // o un sector, y pisar `sectores` con lo que devuelve el servidor a mitad de un
  // drag se sentiría como que el canvas "tira para atrás" lo que se está moviendo.
  useEffect(() => {
    if (modo !== "monitoreo") return

    let cancelado = false

    async function refrescarMesas() {
      try {
        const { data: mesas } = await mesasApi.listar(estadoFiltro ? { estado: estadoFiltro } : undefined)
        if (cancelado) return
        const mesasBySector = new Map<number, Mesa[]>()
        mesas.forEach((m) => {
          const arr = mesasBySector.get(m.sector.id) ?? []
          arr.push(m)
          mesasBySector.set(m.sector.id, arr)
        })
        setSectores((prev) =>
          prev.map((s) => ({ ...s, mesas: mesasBySector.get(s.id) ?? [] }))
        )
        setUltimoRefrescoOk(Date.now())
      } catch {
        // Fallo de red puntual: se reintenta solo en el próximo tick, sin mostrar
        // un error intrusivo por algo que se resuelve solo la mayoría de las veces.
        //
        // Callar acá es correcto, pero no puede ser lo único que pase: si los fallos se
        // encadenan, el salón se queda congelado sin avisar. Por eso `ultimoRefrescoOk`
        // no se toca, y el indicador del encabezado se encarga de que eso se vea.
      }
    }

    const intervalId = setInterval(refrescarMesas, INTERVALO_REFRESCO_MESAS_MS)
    return () => {
      cancelado = true
      clearInterval(intervalId)
    }
    // estadoFiltro entra en las dependencias para que el refresco periódico siga pidiendo
    // el filtro vigente: sin esto el intervalo quedaría capturando el valor que había
    // cuando se montó el efecto y devolvería el salón completo cada 3 segundos.
  }, [modo, estadoFiltro])

  // Alerta de alta ocupación (T26-187, RF-26), solo en monitoreo y por el mismo motivo que
  // el resto: en edición el canvas es para acomodar mesas y un aviso ahí compite con los
  // controles de arrastre, igual que decidió T26-173 para la limpieza demorada.
  //
  // NO depende de estadoFiltro: el % de ocupación es del salón entero, así que filtrar la
  // vista no tiene por qué mover el aviso. Comparte el intervalo con el refresco de mesas
  // para que el canvas y el aviso no se contradigan — si el aviso fuera más lento, el
  // salón se vería lleno unos segundos antes de que apareciera la alerta.
  useEffect(() => {
    if (modo !== "monitoreo") {
      setOcupacion(null)
      return
    }

    let cancelado = false

    async function refrescarOcupacion() {
      try {
        const { data } = await metricasApi.ocupacion()
        if (!cancelado) setOcupacion(data)
      } catch {
        // Igual que el refresco de mesas: un fallo puntual se reintenta en el próximo tick.
        // No se apaga el aviso ni se pisa `error`, que está reservado para el fallo de
        // carga del salón: quedarse sin la métrica no impide seguir operando.
      }
    }

    refrescarOcupacion()
    const intervalId = setInterval(refrescarOcupacion, INTERVALO_REFRESCO_MESAS_MS)
    return () => {
      cancelado = true
      clearInterval(intervalId)
    }
  }, [modo])

  // Mesas reservadas donde el módulo de visión vio gente lejos de la hora reservada y
  // nadie resolvió todavía si corresponde ocuparlas (T26-208). Sale del mismo /mesas que
  // ya se pide cada 3s: no agrega ninguna request al ciclo.
  //
  // Se filtra por permiso porque las dos salidas del aviso —ocupar o descartar— exigen
  // encargado o recepción. A un mozo el cartel le mostraría dos botones que le van a dar
  // 403, que es peor que no verlo.
  const reservasConGente = puedeReservar(rol)
    ? sectores.flatMap((s) => s.mesas ?? []).filter((m) => m.ocupacion_detectada_en)
    : []

  async function handleConfirmarReserva(mesa: Mesa) {
    setResolviendoReserva(true)
    try {
      // Ocupar la mesa limpia la marca sola: el backend borra los datos de reserva en
      // cuanto el estado deja de ser `reservada` (registrar_historial).
      const { data } = await mesasApi.cambiarEstado(mesa.id, "ocupada")
      handleMesaActualizada(data)
    } catch (err) {
      setErrorAccion(await extraerDetalle(err, "No se pudo ocupar la mesa"))
    } finally {
      setResolviendoReserva(false)
    }
  }

  async function handleDescartarReserva(mesa: Mesa) {
    setResolviendoReserva(true)
    try {
      const { data } = await mesasApi.descartarDeteccionEnReserva(mesa.id)
      handleMesaActualizada(data)
    } catch (err) {
      setErrorAccion(await extraerDetalle(err, "No se pudo descartar el aviso"))
    } finally {
      setResolviendoReserva(false)
    }
  }

  function handleMesaEstadoChange(mesaId: number, nuevoEstado: string) {
    const estadoAnterior = sectores.flatMap((s) => s.mesas ?? []).find((m) => m.id === mesaId)?.estado

    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.map((m) => (m.id === mesaId ? { ...m, estado: nuevoEstado } : m)),
      }))
    )

    mesasApi.cambiarEstado(mesaId, nuevoEstado).catch(async (err) => {
      setSectores((prev) =>
        prev.map((s) => ({
          ...s,
          mesas: s.mesas?.map((m) => (m.id === mesaId && estadoAnterior !== undefined ? { ...m, estado: estadoAnterior } : m)),
        }))
      )
      setErrorAccion(await extraerDetalle(err, "Error al cambiar el estado de la mesa"))
    })
  }

  function handleMesaPosicionChange(mesaId: number, pos_x: number, pos_y: number) {
    const posAnterior = sectores.flatMap((s) => s.mesas ?? []).find((m) => m.id === mesaId)

    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.map((m) => (m.id === mesaId ? { ...m, pos_x, pos_y } : m)),
      }))
    )

    mesasApi.cambiarPosicion(mesaId, pos_x, pos_y).catch(async (err) => {
      setSectores((prev) =>
        prev.map((s) => ({
          ...s,
          mesas: s.mesas?.map((m) =>
            m.id === mesaId && posAnterior ? { ...m, pos_x: posAnterior.pos_x, pos_y: posAnterior.pos_y } : m
          ),
        }))
      )
      setErrorAccion(await extraerDetalle(err, "Error al mover la mesa"))
    })
  }

  function handleSectorPosicionChange(sectorId: number, pos_x: number, pos_y: number) {
    const posAnterior = sectores.find((s) => s.id === sectorId)

    setSectores((prev) => prev.map((s) => (s.id === sectorId ? { ...s, pos_x, pos_y } : s)))

    sectoresApi.actualizar(sectorId, { pos_x, pos_y }).catch(async (err) => {
      setSectores((prev) =>
        prev.map((s) =>
          s.id === sectorId && posAnterior ? { ...s, pos_x: posAnterior.pos_x, pos_y: posAnterior.pos_y } : s
        )
      )
      setErrorAccion(await extraerDetalle(err, "Error al mover el sector"))
    })
  }

  function handleSectorResize(sectorId: number, ancho: number, alto: number) {
    const sizeAnterior = sectores.find((s) => s.id === sectorId)

    setSectores((prev) => prev.map((s) => (s.id === sectorId ? { ...s, ancho, alto } : s)))

    sectoresApi.actualizar(sectorId, { ancho, alto }).catch(async (err) => {
      setSectores((prev) =>
        prev.map((s) =>
          s.id === sectorId && sizeAnterior ? { ...s, ancho: sizeAnterior.ancho, alto: sizeAnterior.alto } : s
        )
      )
      setErrorAccion(await extraerDetalle(err, "Error al redimensionar el sector"))
    })
  }

  function handleSalonResize(ancho_salon: number, alto_salon: number) {
    const anterior = configuracion

    setConfiguracion((prev) => (prev ? { ...prev, ancho_salon, alto_salon } : prev))

    configuracionApi.actualizar({ ancho_salon, alto_salon }).catch(async (err) => {
      setConfiguracion(anterior)
      setErrorAccion(await extraerDetalle(err, "Error al redimensionar el salón"))
    })
  }

  function handleSectorActualizado(sectorActualizado: Sector) {
    setSectores((prev) => prev.map((s) => (s.id === sectorActualizado.id ? sectorActualizado : s)))
  }

  function handleSectorEliminado(sectorId: number) {
    setSectores((prev) => prev.filter((s) => s.id !== sectorId))
  }

  function handleMesaEliminada(mesaId: number) {
    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.filter((m) => m.id !== mesaId),
      }))
    )
  }

  function handleMesaActualizada(mesaActualizada: Mesa) {
    setSectores((prev) =>
      prev.map((s) => ({
        ...s,
        mesas: s.mesas?.map((m) => (m.id === mesaActualizada.id ? mesaActualizada : m)),
      }))
    )
  }

  function handleSectorCreado(sector: Sector) {
    setSectores((prev) => [...prev, sector])
    setModalAbierto(null)
  }

  function handleMesaCreada(mesa: Mesa) {
    setSectores((prev) =>
      prev.map((s) => (s.id === mesa.sector.id ? { ...s, mesas: [...(s.mesas ?? []), mesa] } : s))
    )
    setModalAbierto(null)
  }

  // El estado del filtro vive acá (es esta pantalla la que refiltra pidiendo /mesas), pero el
  // control se dibuja dentro de SalonCanvas, a la derecha de los tabs de sector, para que los
  // dos filtros del salón queden juntos en la misma fila.
  //
  // Solo en monitoreo: en edición el filtro se limpia al entrar (ver el botón "Editar
  // disposición") y mostrar el control ahí invitaría a re-filtrar justo cuando conviene ver
  // el salón completo.
  const filtroEstado =
    modo === "monitoreo" ? (
      <div className="flex items-end gap-[12px] flex-wrap">
        <label style={labelStyle}>
          Estado
          <select
            data-testid="dashboard-filtro-estado"
            value={estadoFiltro}
            onChange={(e) => setEstadoFiltro(e.target.value)}
            className="py-[6px] px-[8px] rounded-[6px] border border-gris-250 min-w-[200px]"
          >
            <option value={SIN_FILTRO}>Todos los estados</option>
            {OPCIONES_ESTADO.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>

        {/* Un salón filtrado se ve igual que un salón al que le faltan mesas. El aviso
            existe para que esa diferencia no dependa de que el usuario recuerde que
            dejó un filtro puesto. */}
        {estadoFiltro !== SIN_FILTRO && (
          <span
            data-testid="dashboard-filtro-aviso"
            className="text-[13px] text-marca-fuerte pb-[6px]"
          >
            Mostrando solo mesas en «{ETIQUETA_POR_ESTADO[estadoFiltro]}».{" "}
            <button
              data-testid="dashboard-filtro-limpiar"
              onClick={() => setEstadoFiltro(SIN_FILTRO)}
              className="border-0 bg-[none] p-[0px] text-marca-fuerte text-[13px] font-semibold underline cursor-pointer"
            >
              Ver todas
            </button>
          </span>
        )}
      </div>
    ) : undefined

  return (
    <Layout
      acciones={
        <>
          {/* Qué tan fresco es lo que se ve. Va en el encabezado y no dentro del salón
              porque tiene que seguir visible con el canvas scrolleado, que es justo
              cuando se está mirando una mesa puntual y se decide algo con ella. */}
          <IndicadorFrescura
            ultimoExito={ultimoRefrescoOk}
            intervaloMs={INTERVALO_REFRESCO_MESAS_MS}
            pausado={modo === "edicion"}
          />
          {/* Solo quien puede escribir el layout ve la puerta de entrada al modo edición.
              El criterio es puedeEditarLayout (admin + encargado) y no esAdmin: mover y
              crear mesas/sectores pide `encargado` en el backend, así que gatearlo con
              "solo admin" dejaría al encargado sin su tarea (docs/roles-permisos.md). */}
          {modo === "monitoreo" && puedeEditarLayout(rol) ? (
            <Boton
              variante="primario"
              icono={Pencil}
              onClick={() => {
                // Se limpia el filtro al entrar en edición: acomodar el salón con mesas
                // escondidas es peligroso —se puede soltar una encima de otra que no se
                // ve— y además el filtro es una herramienta de monitoreo, no de armado.
                setEstadoFiltro(SIN_FILTRO)
                setModo("edicion")
              }}
              title="Editar disposición"
            >
              <span className="texto-en-escritorio">Editar disposición</span>
            </Boton>
          ) : null}
        </>
      }
    >

      {modo === "edicion" && (
        <div
          className="flex items-center justify-center gap-[8px] py-[8px] px-[16px] bg-marca-tenue border-b border-b-[#bfdbfe] text-marca-fuerte text-[13px] font-bold"
        >
          <Pencil size={14} />
          Editando disposición del salón
        </div>
      )}

      {modo === "edicion" && (
        <div
          className="fixed inset-[0px] z-[300] border-4 border-marca-fuerte pointer-events-none"
        />
      )}

      <main className="app-main" style={{ paddingBottom: modo === "edicion" ? 96 : undefined }}>
        {loading && (
          <p className="text-[14px] text-gris-400">Cargando salón...</p>
        )}
        {error && (
          <p
            className="text-[14px] text-error bg-error-fondo border border-error-borde rounded-[6px] py-[10px] px-[16px]"
          >
            {error}
          </p>
        )}

        {/* Errores de una acción puntual: mover una mesa, cambiarle el estado, borrar un
            sector (T26-200/F-9). Antes salían por alert(), un diálogo del navegador justo
            en el flujo de uso continuo donde más interrumpe y que además obligaba a los
            tests a interceptar el diálogo nativo en vez de leer el DOM.
            Va aparte del banner de arriba —y no reusa `error`— porque el salón sigue
            dibujado: ver el comentario de errorAccion. Se cierra a mano y lo pisa el
            siguiente error; no se limpia solo, para que uno que aparezca mientras el
            usuario mira otra parte del salón no se pierda antes de que lo lea. */}
        {errorAccion && (
          <p
            data-testid="dashboard-error-accion"
            className="flex items-center justify-between gap-[12px] text-[14px] text-error bg-error-fondo border border-error-borde rounded-[6px] py-[10px] px-[16px]"
          >
            {errorAccion}
            <button
              data-testid="dashboard-error-accion-cerrar"
              onClick={() => setErrorAccion(null)}
              title="Cerrar aviso"
              className="border-0 bg-[none] text-error text-[18px] leading-[1] cursor-pointer py-[0] px-[4px] shrink-0"
            >
              ×
            </button>
          </p>
        )}

        {/* Va arriba de todo lo demás del salón: es lo único de esta pantalla que pide
            una decisión de una persona, y no tiene sentido que quede debajo de avisos
            que solo informan. */}
        {modo === "monitoreo" && (
          <AvisoReservaDetectada
            mesas={reservasConGente}
            onConfirmar={handleConfirmarReserva}
            onDescartar={handleDescartarReserva}
            ocupado={resolviendoReserva}
          />
        )}

        {/* Alerta de alta ocupación (T26-187, RF-26).
            Banner de ancho completo y no un badge sobre el canvas, a diferencia de la
            alerta de limpieza demorada (T26-173): aquella señala UNA mesa y por eso se
            dibuja encima de ella, mientras que esta habla del salón entero y no tiene una
            mesa a la que colgarse. El banner de ancho completo es además el patrón que
            esta misma pantalla ya usa para hablar de todo el salón (el aviso de error de
            arriba y la barra de "Editando disposición").
            La condición la resuelve el backend: acá no se compara nada contra el umbral. */}
        {!loading && !error && ocupacion?.ocupacion_alta && configuracion && (
          <p
            data-testid="dashboard-ocupacion-alta"
            title={`${ocupacion.conteo_por_estado.ocupada} de ${ocupacion.total_mesas} mesas activas están ocupadas`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "0 0 16px 0",
              // Mismo ancho que el canvas, para que el aviso quede alineado con el salón del
              // que habla en vez de estirarse hasta el borde del <main>. Se lee de la
              // configuración y no del localSize de SalonCanvas —que es el que manda durante
              // un resize— porque este aviso solo existe en monitoreo, donde no se redimensiona.
              width: configuracion.ancho_salon,
              // El salon puede ser mas ancho que la pantalla: sin este techo el aviso
              // desborda el viewport en un celular y arrastra la pagina entera con el.
              maxWidth: "100%",
              fontSize: 14,
              fontWeight: 600,
              color: COLOR_OCUPACION_ALTA,
              backgroundColor: "var(--color-aviso-fuerte-fondo)",
              // Borde izquierdo grueso, el mismo recurso con el que T26-173 refuerza el
              // borde de una mesa atrasada: marca la condición sin depender solo del color,
              // que por sí solo no se lee en un monitor lavado ni con daltonismo.
              border: "1px solid var(--color-aviso-fuerte-borde)",
              borderLeft: `4px solid ${COLOR_OCUPACION_ALTA}`,
              borderRadius: 6,
              padding: "10px 16px",
            }}
          >
            <TriangleAlert size={16} />
            Salón al límite: {ocupacion.porcentaje_ocupacion}% de las mesas ocupadas (umbral{" "}
            {ocupacion.umbral_ocupacion_alta}%).
          </p>
        )}

        {!loading && !error && configuracion && (
          // El provider envuelve solo al canvas porque sus tres consumidores —MesaVisual,
          // SectorBloque y PanelMesa— cuelgan de acá para abajo. Envolver el árbol entero
          // obligaría a re-indentar 250 líneas de JSX sin que nada más lo use.
          <AvisoErrorProvider avisar={setErrorAccion}>
            <SalonCanvas
              sectores={sectores}
              modo={modo}
              anchoSalon={configuracion.ancho_salon}
              altoSalon={configuracion.alto_salon}
              // Sale de la configuración que esta pantalla ya carga para el tamaño del
              // salón: no agrega ninguna request al ciclo de refresco (T26-173).
              umbralLimpiezaMinutos={configuracion.minutos_limpieza_demorada}
              filtroEstado={filtroEstado}
              onMesaEstadoChange={handleMesaEstadoChange}
              onMesaPosicionChange={handleMesaPosicionChange}
              onSectorPosicionChange={handleSectorPosicionChange}
              onSectorResize={handleSectorResize}
              onSectorActualizado={handleSectorActualizado}
              onSectorEliminado={handleSectorEliminado}
              onMesaActualizada={handleMesaActualizada}
              onMesaEliminada={handleMesaEliminada}
              onSalonResize={handleSalonResize}
            />
          </AvisoErrorProvider>
        )}
      </main>

      {modo === "edicion" && (
        <div
          className="fixed left-[0px] right-[0px] bottom-[0px] z-[97] flex items-center justify-center gap-[10px] py-[12px] px-[16px] bg-blanco border-t-2 border-t-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
        >
          {puedeEditarLayout(rol) && (
            <>
              {/* El "+" va en el texto y no como icono, aunque el icono se vea mejor: el
                  rótulo tiene que quedar idéntico al de antes de T26-205. Cambiarlo movía
                  el nombre accesible del botón de "+ Nuevo sector" a "Nuevo sector", que
                  es lo que ve un lector de pantalla y lo que usa la suite para ubicarlo. */}
              <Boton onClick={() => setModalAbierto("sector")}>+ Nuevo sector</Boton>
              <Boton onClick={() => setModalAbierto("mesa")}>+ Nueva mesa</Boton>
            </>
          )}
          {/* Sin gate: es la única salida del modo edición. Esconderla ante un rol sin
              permiso lo dejaría encerrado en una pantalla que no puede usar. */}
          <Boton onClick={() => setModo("monitoreo")} style={editExitBtnStyle}>
            Salir de edición
          </Boton>
        </div>
      )}

      {modalAbierto === "sector" && (
        <ModalAltaSector onClose={() => setModalAbierto(null)} onSectorCreado={handleSectorCreado} />
      )}
      {modalAbierto === "mesa" && (
        <ModalAltaMesa sectores={sectores} onClose={() => setModalAbierto(null)} onMesaCreada={handleMesaCreada} />
      )}
    </Layout>
  )
}

// Salir de edición no es ninguna de las variantes de Boton: es la única salida de un
// modo, y el negro la separa de las dos acciones azules que tiene al lado para que no
// se lea como una tercera cosa que crear.
const editExitBtnStyle: React.CSSProperties = {
  padding: "0 18px",
  borderRadius: 8,
  border: "none",
  backgroundColor: "var(--color-gris-900)",
  color: "var(--color-blanco)",
  fontSize: 14,
  fontWeight: 600,
}
