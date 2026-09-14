# GET /estados: listado de solo lectura de los estados posibles de una mesa (T26-157, RF-29).
#
# RF-29 pide textualmente "administrar" los estados, lo que en rigor implica CRUD completo.
# Se descarta para este sprint: EstadoMesa está hardcodeado en múltiples puntos del sistema
# (COLOR_POR_ESTADO/ETIQUETA_POR_ESTADO en frontend, el flujo libre->ocupada->limpieza en
# backend, vision-module), y migrar todo eso a una tabla dinámica es riesgoso a dos sprints
# del cierre. Este endpoint solo lee el enum ya definido en app/models/mesa.py (create_type=
# False: el tipo vive en la base, no lo crea este backend) — sin tabla ni persistencia nueva.
# El CRUD completo queda documentado como mejora futura en la sección 8.5 del anteproyecto.
#
# Por qué sigue existiendo teniendo el frontend su propio ETIQUETA_POR_ESTADO (T26-200/I-3).
#
# Su único consumidor es ConfiguracionPage, y es a propósito. Los dos lados responden
# preguntas distintas sobre el mismo enum:
#
#   - ETIQUETA_POR_ESTADO (frontend/src/constants.ts) es con qué se PINTA un estado que ya se
#     tiene. Lo usan el canvas, el panel de mesa y el historial, en pleno render y a 3s de
#     refresco: tiene que ser síncrono, así que no puede salir de una request.
#   - Este endpoint es qué estados EXISTEN. Eso solo lo sabe el backend, porque el enum vive
#     acá. Es lo que ConfiguracionPage le muestra al admin, como introspección real del
#     sistema y no como un eco de una lista escrita del otro lado.
#
# Migrar esa pantalla al mapa del frontend daría de baja este endpoint, pero convertiría la
# sección en una copia estática de lo que ya se ve en todas las demás: dejaría de reflejar el
# enum real. Por eso conviven.
#
# El riesgo que esto deja abierto —agregar un estado acá no rompe nada en el frontend, solo
# hace que el mapa quede incompleto en silencio— es conocido y es el precio de tener un mapa
# síncrono para el render. Si algún día se agrega un estado, hay que tocar los dos lados.

from fastapi import APIRouter, Depends

from app.models.mesa import EstadoMesa
from app.routers.auth import get_usuario_actual
from app.schemas.estado import EstadoResponse

router = APIRouter(dependencies=[Depends(get_usuario_actual)])

# Mismas etiquetas que ETIQUETA_POR_ESTADO en frontend/src/components/PanelMesa.tsx, para
# que el backend no proponga un texto distinto al que ya ve el usuario en el panel de mesa.
ETIQUETA_POR_ESTADO: dict[EstadoMesa, str] = {
    EstadoMesa.libre: "Libre",
    EstadoMesa.ocupada: "Ocupada",
    EstadoMesa.pendiente_limpieza: "Pendiente de limpieza",
    EstadoMesa.reservada: "Reservada",
}


@router.get("/", response_model=list[EstadoResponse])
def listar_estados():
    return [EstadoResponse(valor=estado, etiqueta=etiqueta) for estado, etiqueta in ETIQUETA_POR_ESTADO.items()]
