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
import { Save, RotateCcw } from "lucide-react"
import { configuracionApi, sectoresApi, extraerDetalleApi } from "../services/api"
import type { Configuracion, Sector } from "../types"
import { calcularMinimoSalon } from "../constants"

// Los inputs se manejan como texto: un input numérico vaciado devuelve "", y convertirlo a
// número en cada tecla haría que borrar el último dígito saltara a 0 y se viera como un
// campo que se defiende de que lo editen.
interface FormState {
  nombre: string
  cantidadMesas: string
  ancho: string
  alto: string
}

function aFormState(config: Configuracion): FormState {
  return {
    nombre: config.nombre_establecimiento ?? "",
    cantidadMesas: config.cantidad_mesas_referencia?.toString() ?? "",
    ancho: config.ancho_salon.toString(),
    alto: config.alto_salon.toString(),
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
  const navigate = useNavigate()

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Los sectores se piden para saber cuánto se puede achicar el salón sin dejarlos
      // afuera; el backend no valida eso, solo exige gt=0.
      const [configRes, sectoresRes] = await Promise.all([configuracionApi.obtener(), sectoresApi.listar()])
      const config: Configuracion = configRes.data
      const sectores: Sector[] = sectoresRes.data
      setOriginal(config)
      setForm(aFormState(config))
      setMinimo(calcularMinimoSalon(sectores))
    } catch (err) {
      setError(await extraerDetalleApi(err, "Error al cargar la configuración"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

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

    try {
      const { data } = await configuracionApi.actualizar(datos)
      // Se re-sincroniza con lo que devolvió el backend, no con lo que se tipeó: si el
      // servidor no aplicó algo, la pantalla tiene que mostrar la verdad y no el deseo.
      setOriginal(data)
      setForm(aFormState(data))
      setExito("Configuración guardada.")
      if (form.cantidadMesas === "" && data.cantidad_mesas_referencia != null) {
        setAviso(
          "La cantidad de mesas de referencia no se puede borrar una vez cargada, así que se mantuvo el valor anterior."
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
      </main>
    </div>
  )
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string
  ayuda: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{etiqueta}</span>
      {children}
      <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>{ayuda}</span>
    </label>
  )
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
