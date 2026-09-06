// Pantalla de configuración general del salón (T26-160, RF-28).
//
// El ticket la describía como "extender el formulario existente", pero no había ninguno: lo
// único que escribía configuración era el resize por arrastre del canvas (DashboardPage ->
// handleSalonResize). Así que esta pantalla se crea de cero y pasa a ser el lugar donde se
// editan los cuatro campos de configuracion_general, incluidos el ancho y el alto que hasta
// ahora solo se podían tocar arrastrando el borde del salón.
//
// Solo admin: el PATCH /configuracion exige rol admin en el backend, así que la ruta va
// detrás de AdminRoute además de PrivateRoute (ver App.tsx).

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Save, RotateCcw, AlertTriangle, CheckCircle2 } from "lucide-react"
import {
  configuracionApi,
  sectoresApi,
  estadosApi,
  mesasApi,
  camarasApi,
  roiMesaApi,
  extraerDetalleApi,
} from "../services/api"
import type { Configuracion, Sector, EstadoOpcion, Mesa, Camara, RoiMesa } from "../types"
import { calcularMinimoSalon, COLOR_POR_ESTADO } from "../constants"

// Recuento de la instalación y, sobre todo, de lo que falta configurar (T26-168).
interface ResumenSetup {
  sectores: number
  mesas: number
  camaras: number
  rois: number
  mesasSinRoi: number
  sectoresSinCamara: number
  camarasSinRoi: number
}

/**
 * Cruza los cuatro listados en memoria. Se recibe todo ya traído y completo —una llamada por
 * recurso, no una por mesa— porque preguntar los ROIs mesa por mesa serían N requests contra
 * una base remota para responder algo que se resuelve con dos Sets.
 *
 * Los cuatro listados vienen filtrados por activos: es el default de los cuatro endpoints.
 */
function calcularResumen(
  sectores: Sector[],
  mesas: Mesa[],
  camaras: Camara[],
  rois: RoiMesa[]
): ResumenSetup {
  const mesasConRoi = new Set(rois.map((r) => r.mesa_id))
  const camarasConRoi = new Set(rois.map((r) => r.camara_id))
  const sectoresConCamara = new Set(camaras.map((c) => c.sector_id))
  return {
    sectores: sectores.length,
    mesas: mesas.length,
    camaras: camaras.length,
    rois: rois.length,
    mesasSinRoi: mesas.filter((m) => !mesasConRoi.has(m.id)).length,
    sectoresSinCamara: sectores.filter((s) => !sectoresConCamara.has(s.id)).length,
    camarasSinRoi: camaras.filter((c) => !camarasConRoi.has(c.id)).length,
  }
}

// Los inputs se manejan como texto: un input numérico vaciado devuelve "", y convertirlo a
// número en cada tecla haría que borrar el último dígito saltara a 0 y se viera como un
// campo que se defiende de que lo editen.
interface FormState {
  nombre: string
  cantidadMesas: string
  ancho: string
  alto: string
  horaApertura: string
  horaCierre: string
  minutosLimpieza: string
}

// El backend devuelve "HH:MM:SS" y el <input type="time"> trabaja con "HH:MM". Sin
// recortar, el input llega vacío porque no reconoce el valor y el formulario parece
// no haber cargado el horario que sí está guardado.
function aHoraInput(hora: string | null | undefined): string {
  return hora ? hora.slice(0, 5) : ""
}

function aFormState(config: Configuracion): FormState {
  return {
    nombre: config.nombre_establecimiento ?? "",
    cantidadMesas: config.cantidad_mesas_referencia?.toString() ?? "",
    ancho: config.ancho_salon.toString(),
    alto: config.alto_salon.toString(),
    horaApertura: aHoraInput(config.hora_apertura),
    horaCierre: aHoraInput(config.hora_cierre),
    minutosLimpieza: config.minutos_limpieza_demorada?.toString() ?? "",
  }
}

export default function ConfiguracionPage() {
  const [form, setForm] = useState<FormState | null>(null)
  const [original, setOriginal] = useState<Configuracion | null>(null)
  const [minimo, setMinimo] = useState({ ancho: 0, alto: 0 })
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Los estados se cargan aparte del formulario y con su propio error: son un bloque
  // informativo de solo lectura, así que si GET /estados/ falla la pantalla tiene que
  // seguir permitiendo editar y guardar la configuración, no romperse entera.
  const [estados, setEstados] = useState<EstadoOpcion[] | null>(null)
  const [errorEstados, setErrorEstados] = useState<string | null>(null)
  // Mismo criterio que los estados: el resumen es informativo, así que su carga y su error
  // van por separado y no pueden dejar el formulario inutilizable.
  const [sectores, setSectores] = useState<Sector[] | null>(null)
  const [resumen, setResumen] = useState<ResumenSetup | null>(null)
  const [errorResumen, setErrorResumen] = useState<string | null>(null)
  const navigate = useNavigate()

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Los sectores se piden para saber cuánto se puede achicar el salón sin dejarlos
      // afuera; el backend no valida eso, solo exige gt=0.
      const [configRes, sectoresRes] = await Promise.all([configuracionApi.obtener(), sectoresApi.listar()])
      const config: Configuracion = configRes.data
      const sectoresCargados: Sector[] = sectoresRes.data
      setOriginal(config)
      setForm(aFormState(config))
      setMinimo(calcularMinimoSalon(sectoresCargados))
      // Se guardan para el resumen del setup, que los necesita y así no los vuelve a pedir.
      setSectores(sectoresCargados)
    } catch (err) {
      setError(await extraerDetalleApi(err, "Error al cargar la configuración"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Una sola vez: el listado sale de un enum del backend, no cambia entre recargas del
  // formulario, así que no tiene sentido colgarlo de cargar().
  useEffect(() => {
    let cancelado = false
    estadosApi
      .listar()
      .then(({ data }) => {
        if (!cancelado) setEstados(data)
      })
      .catch(async (err) => {
        if (!cancelado) setErrorEstados(await extraerDetalleApi(err, "No se pudieron cargar los estados."))
      })
    return () => {
      cancelado = true
    }
  }, [])

  // Los sectores ya los trajo cargar(); acá faltan los otros tres listados. Tres requests en
  // paralelo y el cruce en memoria: pedir los ROIs de a una mesa serían N idas al servidor.
  useEffect(() => {
    if (sectores === null) return
    let cancelado = false
    Promise.all([mesasApi.listar(), camarasApi.listar(), roiMesaApi.listar()])
      .then(([mesasRes, camarasRes, roisRes]) => {
        if (cancelado) return
        setResumen(calcularResumen(sectores, mesasRes.data, camarasRes.data, roisRes.data))
      })
      .catch(async (err) => {
        if (!cancelado) setErrorResumen(await extraerDetalleApi(err, "No se pudo cargar el resumen del setup."))
      })
    return () => {
      cancelado = true
    }
  }, [sectores])

  function editar(campo: keyof FormState, valor: string) {
    setForm((prev) => (prev ? { ...prev, [campo]: valor } : prev))
    // Cualquier edición invalida el resultado del guardado anterior: dejarlo en pantalla
    // haría pensar que lo que se está tipeando ya quedó guardado.
    setExito(null)
    setAviso(null)
  }

  function validar(f: FormState): string | null {
    const ancho = Number(f.ancho)
    const alto = Number(f.alto)
    if (!Number.isInteger(ancho) || ancho <= 0) return "El ancho del salón tiene que ser un número entero mayor que 0."
    if (!Number.isInteger(alto) || alto <= 0) return "El alto del salón tiene que ser un número entero mayor que 0."
    if (ancho < minimo.ancho) {
      return `El ancho no puede ser menor que ${minimo.ancho} px: es el espacio que ocupan los sectores actuales y quedarían fuera del salón.`
    }
    if (alto < minimo.alto) {
      return `El alto no puede ser menor que ${minimo.alto} px: es el espacio que ocupan los sectores actuales y quedarían fuera del salón.`
    }
    if (f.cantidadMesas !== "") {
      const cantidad = Number(f.cantidadMesas)
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        return "La cantidad de mesas de referencia tiene que ser un número entero mayor que 0."
      }
    }
    // Las dos o ninguna: con una sola hora no hay franja que aplicar, y el backend en ese
    // caso ignora el recorte por completo. Es mejor decirlo acá que dejar guardar algo
    // que no va a tener ningún efecto.
    if ((f.horaApertura === "") !== (f.horaCierre === "")) {
      return "Cargá las dos horas o ninguna: con una sola no se puede acotar el horario de servicio."
    }
    if (f.minutosLimpieza !== "") {
      const minutos = Number(f.minutosLimpieza)
      if (!Number.isInteger(minutos) || minutos <= 0) {
        return "El umbral de limpieza demorada tiene que ser un número entero de minutos mayor que 0."
      }
    }
    return null
  }

  async function handleGuardar() {
    if (!form) return
    const problema = validar(form)
    if (problema) {
      setError(problema)
      setExito(null)
      setAviso(null)
      return
    }

    setGuardando(true)
    setError(null)
    setExito(null)
    setAviso(null)

    const datos: {
      ancho_salon: number
      alto_salon: number
      nombre_establecimiento: string
      cantidad_mesas_referencia?: number
      hora_apertura?: string
      hora_cierre?: string
      minutos_limpieza_demorada?: number
    } = {
      ancho_salon: Number(form.ancho),
      alto_salon: Number(form.alto),
      // Se manda "" a propósito cuando está vacío: el backend ignora los null
      // (exclude_none), así que mandar null dejaría el nombre viejo sin avisar.
      nombre_establecimiento: form.nombre.trim(),
    }
    // En cambio la cantidad no se puede vaciar: 0 falla la validación gt=0 y null se ignora,
    // así que si el campo quedó vacío se omite y se avisa abajo con lo que devolvió el server.
    if (form.cantidadMesas !== "") {
      datos.cantidad_mesas_referencia = Number(form.cantidadMesas)
    }
    // Mismo caso que la cantidad: vacío se omite en vez de mandar null, que el backend
    // descartaría igual. La consecuencia es que el horario no se puede borrar una vez
    // cargado; se avisa abajo comparando contra lo que devolvió el servidor.
    if (form.horaApertura !== "") datos.hora_apertura = form.horaApertura
    if (form.horaCierre !== "") datos.hora_cierre = form.horaCierre
    if (form.minutosLimpieza !== "") datos.minutos_limpieza_demorada = Number(form.minutosLimpieza)

    try {
      const { data } = await configuracionApi.actualizar(datos)
      // Se re-sincroniza con lo que devolvió el backend, no con lo que se tipeó: si el
      // servidor no aplicó algo, la pantalla tiene que mostrar la verdad y no el deseo.
      setOriginal(data)
      setForm(aFormState(data))
      setExito("Configuración guardada.")
      const noBorrables: string[] = []
      if (form.cantidadMesas === "" && data.cantidad_mesas_referencia != null) {
        noBorrables.push("la cantidad de mesas de referencia")
      }
      if (form.horaApertura === "" && data.hora_apertura != null) {
        noBorrables.push("el horario de servicio")
      }
      if (form.minutosLimpieza === "" && data.minutos_limpieza_demorada != null) {
        noBorrables.push("el umbral de limpieza demorada")
      }
      if (noBorrables.length > 0) {
        setAviso(
          `No se puede borrar ${noBorrables.join(" ni ")} una vez cargado desde esta pantalla, ` +
            "así que se mantuvo el valor anterior."
        )
      }
    } catch (err) {
      setError(await extraerDetalleApi(err, "Error al guardar la configuración"))
    } finally {
      setGuardando(false)
    }
  }

  function handleDeshacer() {
    if (!original) return
    setForm(aFormState(original))
    setError(null)
    setExito(null)
    setAviso(null)
  }

  const hayCambios =
    form !== null && original !== null && JSON.stringify(form) !== JSON.stringify(aFormState(original))

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <header
        style={{
          backgroundColor: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Configuración</h1>
        <button onClick={() => navigate("/")} style={estiloBoton}>
          Volver al salón
        </button>
      </header>

      <main style={{ padding: 24, maxWidth: 640 }}>
        {loading && <p style={{ fontSize: 14, color: "#888" }}>Cargando configuración...</p>}

        {error && (
          <p data-testid="configuracion-error" style={estiloError}>
            {error}
          </p>
        )}

        {exito && (
          <p data-testid="configuracion-exito" style={estiloExito}>
            {exito}
          </p>
        )}

        {aviso && (
          <p data-testid="configuracion-aviso" style={estiloAviso}>
            {aviso}
          </p>
        )}

        {!loading && form && (
          <div
            style={{
              backgroundColor: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <Campo
              etiqueta="Nombre del establecimiento"
              ayuda="Se usa para identificar el local en la aplicación."
            >
              <input
                type="text"
                data-testid="configuracion-nombre"
                value={form.nombre}
                onChange={(e) => editar("nombre", e.target.value)}
                placeholder="Sin nombre"
                style={estiloInput}
              />
            </Campo>

            <Campo
              etiqueta="Cantidad de mesas de referencia"
              ayuda="Dato informativo para planificación. No limita ni se compara con las mesas realmente cargadas."
            >
              <input
                type="number"
                min={1}
                data-testid="configuracion-cantidad-mesas"
                value={form.cantidadMesas}
                onChange={(e) => editar("cantidadMesas", e.target.value)}
                placeholder="Sin definir"
                style={estiloInput}
              />
            </Campo>

            <div style={{ height: 1, backgroundColor: "#e2e8f0" }} />

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 160px" }}>
                <Campo etiqueta="Hora de apertura">
                  <input
                    type="time"
                    data-testid="configuracion-hora-apertura"
                    value={form.horaApertura}
                    onChange={(e) => editar("horaApertura", e.target.value)}
                    style={estiloInput}
                  />
                </Campo>
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <Campo etiqueta="Hora de cierre">
                  <input
                    type="time"
                    data-testid="configuracion-hora-cierre"
                    value={form.horaCierre}
                    onChange={(e) => editar("horaCierre", e.target.value)}
                    style={estiloInput}
                  />
                </Campo>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
              {form.horaApertura && form.horaCierre
                ? `Las métricas de rotación cuentan solo lo que pasa entre las ${form.horaApertura} y las ${form.horaCierre}.` +
                  (form.horaCierre < form.horaApertura ? " El cierre después de medianoche está contemplado." : "")
                : "Sin horario cargado, las métricas cuentan las 24 horas del día, incluidas las horas con el local cerrado."}
            </p>

            <Campo
              etiqueta="Avisar limpieza demorada después de (minutos)"
              ayuda="Las mesas que lleven más de este tiempo pendientes de limpieza se marcan en el salón. Vacío: sin aviso."
            >
              <input
                type="number"
                min={1}
                data-testid="configuracion-minutos-limpieza"
                value={form.minutosLimpieza}
                onChange={(e) => editar("minutosLimpieza", e.target.value)}
                placeholder="Sin aviso"
                style={estiloInput}
              />
            </Campo>

            <div style={{ height: 1, backgroundColor: "#e2e8f0" }} />

            <Campo
              etiqueta="Ancho del salón (px)"
              ayuda={`Mínimo ${minimo.ancho} px, que es lo que ocupan los sectores actuales.`}
            >
              <input
                type="number"
                min={minimo.ancho}
                data-testid="configuracion-ancho"
                value={form.ancho}
                onChange={(e) => editar("ancho", e.target.value)}
                style={estiloInput}
              />
            </Campo>

            <Campo
              etiqueta="Alto del salón (px)"
              ayuda={`Mínimo ${minimo.alto} px, que es lo que ocupan los sectores actuales.`}
            >
              <input
                type="number"
                min={minimo.alto}
                data-testid="configuracion-alto"
                value={form.alto}
                onChange={(e) => editar("alto", e.target.value)}
                style={estiloInput}
              />
            </Campo>

            <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
              El tamaño del salón también se puede ajustar arrastrando su borde inferior derecho
              desde el modo edición del panel principal.
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                data-testid="configuracion-guardar"
                onClick={handleGuardar}
                disabled={guardando || !hayCambios}
                style={{
                  ...estiloBotonPrimario,
                  opacity: guardando || !hayCambios ? 0.5 : 1,
                  cursor: guardando || !hayCambios ? "default" : "pointer",
                }}
              >
                <Save size={15} />
                {guardando ? "Guardando..." : "Guardar cambios"}
              </button>

              <button
                data-testid="configuracion-deshacer"
                onClick={handleDeshacer}
                disabled={guardando || !hayCambios}
                style={{
                  ...estiloBotonSecundario,
                  opacity: guardando || !hayCambios ? 0.5 : 1,
                  cursor: guardando || !hayCambios ? "default" : "pointer",
                }}
              >
                <RotateCcw size={15} />
                Deshacer
              </button>
            </div>
          </div>
        )}

        <section data-testid="configuracion-resumen" style={estiloTarjeta}>
          <div>
            <h2 style={estiloTituloSeccion}>Resumen del setup</h2>
            <p style={estiloAyudaSeccion}>
              Estado de la instalación y qué falta configurar para que la detección automática
              cubra todo el salón.
            </p>
          </div>

          {errorResumen && (
            <p data-testid="configuracion-resumen-error" style={estiloAviso}>
              {errorResumen}
            </p>
          )}

          {!errorResumen && resumen === null && (
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Cargando resumen...</p>
          )}

          {resumen && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                <Conteo testid="configuracion-resumen-sectores" etiqueta="Sectores" valor={resumen.sectores} />
                <Conteo testid="configuracion-resumen-mesas" etiqueta="Mesas" valor={resumen.mesas} />
                <Conteo testid="configuracion-resumen-camaras" etiqueta="Cámaras" valor={resumen.camaras} />
                <Conteo testid="configuracion-resumen-rois" etiqueta="ROIs" valor={resumen.rois} />
              </div>

              <div style={{ height: 1, backgroundColor: "#e2e8f0" }} />

              {/* Orden deliberado: de lo que deja más ciego el sistema a lo que menos. Una mesa
                  sin ROI nunca se detecta; un sector sin cámara son todas sus mesas a la vez. */}
              {resumen.mesasSinRoi > 0 && (
                <Hueco
                  testid="configuracion-hueco-mesas-sin-roi"
                  texto={`${resumen.mesasSinRoi} ${resumen.mesasSinRoi === 1 ? "mesa activa no tiene" : "mesas activas no tienen"} ningún ROI: la detección automática nunca las va a marcar.`}
                  accion="Calibrar ROI"
                  onAccion={() => navigate("/calibracion-roi")}
                />
              )}

              {resumen.sectoresSinCamara > 0 && (
                <Hueco
                  testid="configuracion-hueco-sectores-sin-camara"
                  texto={`${resumen.sectoresSinCamara} ${resumen.sectoresSinCamara === 1 ? "sector no tiene" : "sectores no tienen"} ninguna cámara activa asignada: queda entero sin cobertura.`}
                  accion="Cámaras"
                  onAccion={() => navigate("/camaras")}
                />
              )}

              {resumen.camarasSinRoi > 0 && (
                <Hueco
                  testid="configuracion-hueco-camaras-sin-roi"
                  texto={`${resumen.camarasSinRoi} ${resumen.camarasSinRoi === 1 ? "cámara activa no tiene" : "cámaras activas no tienen"} ningún ROI cargado: está filmando pero no aporta nada.`}
                  accion="Calibrar ROI"
                  onAccion={() => navigate("/calibracion-roi")}
                />
              )}

              {resumen.mesasSinRoi === 0 && resumen.sectoresSinCamara === 0 && resumen.camarasSinRoi === 0 && (
                <div
                  data-testid="configuracion-sin-huecos"
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1b5e20" }}
                >
                  <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                  No falta nada por configurar: todas las mesas tienen ROI y todos los sectores
                  tienen cámara.
                </div>
              )}

              {/* Informativo, nunca una advertencia: cantidad_mesas_referencia es un dato de
                  planificación que carga el admin y no tiene por qué coincidir con las mesas
                  cargadas. Hasta acá era un número que nadie leía en ningún lado. */}
              {original?.cantidad_mesas_referencia != null && (
                <p data-testid="configuracion-referencia-contraste" style={estiloAyudaSeccion}>
                  {`Tenés ${resumen.mesas} ${resumen.mesas === 1 ? "mesa cargada" : "mesas cargadas"} y la referencia de planificación es ${original.cantidad_mesas_referencia}.`}
                </p>
              )}
            </>
          )}
        </section>

        <section data-testid="configuracion-estados" style={estiloTarjeta}>
          <div>
            <h2 style={estiloTituloSeccion}>Estados de mesa</h2>
            <p style={estiloAyudaSeccion}>
              Los estados son fijos: los define el sistema y no se pueden agregar ni renombrar desde
              acá. Se listan para que se vea qué colores significan qué en el salón.
            </p>
          </div>

          {errorEstados && (
            <p data-testid="configuracion-estados-error" style={estiloAviso}>
              {errorEstados}
            </p>
          )}

          {!errorEstados && estados === null && (
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Cargando estados...</p>
          )}

          {estados?.map((estado) => (
            <div
              key={estado.valor}
              data-testid={`configuracion-estado-${estado.valor}`}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  flexShrink: 0,
                  // El gris cubre un estado que exista en el backend pero todavía no en la
                  // paleta: se prefiere una fila sin color a una fila que no se dibuja.
                  backgroundColor: COLOR_POR_ESTADO[estado.valor] ?? "#9e9e9e",
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#334155" }}>{estado.etiqueta}</span>
              <code style={{ fontSize: 12, color: "#94a3b8" }}>{estado.valor}</code>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}

function Conteo({ testid, etiqueta, valor }: { testid: string; etiqueta: string; valor: number }) {
  return (
    <div data-testid={testid}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1e293b", lineHeight: 1.2 }}>{valor}</div>
      <div style={{ fontSize: 12, color: "#94a3b8" }}>{etiqueta}</div>
    </div>
  )
}

// Un hueco siempre es accionable: el número solo obliga a adivinar dónde se arregla, así que
// va con el botón que lleva a la pantalla que lo resuelve.
function Hueco({
  testid,
  texto,
  accion,
  onAccion,
}: {
  testid: string
  texto: string
  accion: string
  onAccion: () => void
}) {
  return (
    <div
      data-testid={testid}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 6,
        backgroundColor: "#fff8e1",
        border: "1px solid #ffe082",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#8a6d0b" }}>
        <AlertTriangle size={16} style={{ flexShrink: 0 }} />
        {texto}
      </span>
      <button onClick={onAccion} style={{ ...estiloBoton, minHeight: 36 }}>
        {accion}
      </button>
    </div>
  )
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string
  // Opcional: los campos de horario se explican con un texto compartido debajo de los
  // dos, y un span vacío por campo dejaría un hueco raro entre el input y lo siguiente.
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{etiqueta}</span>
      {children}
      {ayuda && <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>{ayuda}</span>}
    </label>
  )
}

// Mismo recuadro blanco que la tarjeta del formulario, para que las secciones de solo
// lectura que se agregan debajo no parezcan de otra pantalla.
const estiloTarjeta: React.CSSProperties = {
  backgroundColor: "#fff",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: 20,
  marginTop: 20,
  display: "flex",
  flexDirection: "column",
  gap: 12,
}

const estiloTituloSeccion: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#1e293b",
  margin: "0 0 4px",
}

const estiloAyudaSeccion: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "#94a3b8",
  lineHeight: 1.5,
}

const estiloInput: React.CSSProperties = {
  minHeight: 44,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
  fontFamily: "inherit",
  color: "#1e293b",
  width: "100%",
  boxSizing: "border-box",
}

const estiloBoton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 6,
  border: "1px solid #1976d2",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  backgroundColor: "#fff",
  color: "#1976d2",
  whiteSpace: "nowrap",
}

const estiloBotonPrimario: React.CSSProperties = {
  ...estiloBoton,
  border: "none",
  backgroundColor: "#1976d2",
  color: "#fff",
  fontWeight: 600,
}

const estiloBotonSecundario: React.CSSProperties = {
  ...estiloBoton,
  border: "1px solid #ccc",
  color: "#444",
}

const estiloError: React.CSSProperties = {
  fontSize: 14,
  color: "#c62828",
  backgroundColor: "#ffebee",
  border: "1px solid #ef9a9a",
  borderRadius: 6,
  padding: "10px 16px",
  marginTop: 0,
}

const estiloExito: React.CSSProperties = {
  fontSize: 14,
  color: "#1b5e20",
  backgroundColor: "#e8f5e9",
  border: "1px solid #a5d6a7",
  borderRadius: 6,
  padding: "10px 16px",
  marginTop: 0,
}

const estiloAviso: React.CSSProperties = {
  fontSize: 13,
  color: "#8a6d0b",
  backgroundColor: "#fff8e1",
  border: "1px solid #ffe082",
  borderRadius: 6,
  padding: "10px 16px",
  marginTop: 0,
}
