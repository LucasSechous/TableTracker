// La cámara que enfoca una mesa, dentro de su panel (T26-206).
//
// El vínculo mesa -> cámara no es un campo de la mesa: existe porque alguien dibujó un ROI
// sobre el frame de una cámara para esa mesa. Por eso se resuelve con GET /roi-mesa/
// filtrando por mesa_id, que ya devuelve camara_id y camara_nombre —"datos de contexto
// para no obligar a la UI a cruzar con /mesas y /camaras", dice el schema—, así que
// alcanza una sola llamada.
//
// Por qué solo admin
//
// Los dos endpoints que esto necesita son de admin: GET /roi-mesa/ y, sobre todo,
// GET /camaras/{id}/stream. Y no es un detalle de implementación que se pueda aflojar:
// docs/privacidad-vision.md declara esa restricción como control de privacidad y la
// referencia contra las secciones 9.2, 13.6 y 14.4 del anteproyecto. Abrir el video en
// vivo a mozo, recepción o limpieza contradiría algo que la tesis da por cumplido.
//
// Para los demás roles el componente no se dibuja. No se muestra un cartel de "no tenés
// permiso": el panel de la mesa es su herramienta de trabajo diaria y no corresponde
// llenarlo con avisos de algo que no van a poder hacer nunca.
//
// Por qué el video no arranca solo
//
// La cámara es física y ya tiene una conexión RTSP abierta: la del módulo de visión. Abrir
// una segunda cada vez que alguien toca una mesa —y el panel se abre a cada rato durante
// el servicio— competiría con la detección por el mismo aparato, que es la función
// principal del sistema. Así que lo que aparece solo es QUÉ cámara la enfoca, que es lo
// que el ticket pide y cuesta una request; el video en vivo queda a un toque de distancia.

import { useEffect, useState } from "react"
import { Camera } from "lucide-react"
import { roiMesaApi, extraerDetalle } from "../services/api"
import CamaraEnVivo from "./CamaraEnVivo"
import Boton from "./ui/Boton"

interface Props {
  mesaId: number
  /** Si el rol puede ver cámaras. Con false el componente no dibuja nada. */
  habilitado: boolean
}

interface CamaraDelRoi {
  id: number
  nombre: string
}

export default function CamaraDeLaMesa({ mesaId, habilitado }: Props) {
  const [camara, setCamara] = useState<CamaraDelRoi | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState(false)

  useEffect(() => {
    if (!habilitado) return
    let cancelado = false
    // Se reinicia al cambiar de mesa: sin esto, abrir una mesa sin cámara justo después de
    // una con cámara mostraría la cámara de la anterior hasta que llegara la respuesta.
    setCamara(null)
    setViendo(false)
    setError(null)
    setCargando(true)

    roiMesaApi
      .listar({ mesa_id: mesaId })
      .then(({ data }) => {
        if (cancelado) return
        // Puede haber más de un ROI si la mesa quedó cubierta por dos cámaras. Se toma el
        // primero activo: mostrar una es responder "cuál la enfoca", y elegir entre varias
        // sería una pantalla aparte.
        const roi = data.find((r) => r.activa)
        setCamara(roi ? { id: roi.camara_id, nombre: roi.camara_nombre ?? `Cámara ${roi.camara_id}` } : null)
      })
      .catch(async (err) => {
        if (cancelado) return
        setError(await extraerDetalle(err, "No se pudo averiguar qué cámara enfoca la mesa"))
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })

    return () => {
      cancelado = true
    }
  }, [mesaId, habilitado])

  if (!habilitado) return null

  return (
    <div className="mb-[24px]" data-testid="panel-mesa-camara">
      <div style={etiquetaStyle}>Cámara</div>

      {cargando && <div className="text-[13px] text-gris-400">Buscando la cámara...</div>}

      {!cargando && error && (
        <div className="text-[13px] text-error" data-testid="panel-mesa-camara-error">
          {error}
        </div>
      )}

      {!cargando && !error && !camara && (
        // Que una mesa no tenga cámara es normal, no un fallo: se calibra ROI solo donde
        // hace falta. Se dice como un hecho y se nombra la pantalla donde se resuelve.
        <div className="text-[13px] text-gris-500" data-testid="panel-mesa-sin-camara">
          Ninguna cámara enfoca esta mesa. Se asigna dibujando su ROI en Calibración de ROI.
        </div>
      )}

      {!cargando && !error && camara && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[14px] font-semibold text-slate-900" data-testid="panel-mesa-camara-nombre">
            {camara.nombre}
          </div>

          {viendo ? (
            <CamaraEnVivo key={camara.id} camaraId={camara.id} nombre={camara.nombre} />
          ) : (
            <Boton icono={Camera} data-testid="panel-mesa-ver-camara" onClick={() => setViendo(true)}>
              Ver en vivo
            </Boton>
          )}
        </div>
      )}
    </div>
  )
}

// Mismo rótulo de sección que usa el resto del panel.
const etiquetaStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--color-slate-400)",
  marginBottom: 8,
}
