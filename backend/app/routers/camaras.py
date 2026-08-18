import cv2
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import get_db
from app.models.camara import Camara
from app.models.sector import Sector
from app.schemas.camara import CamaraCreate, CamaraUpdate, CamaraResponse, CamaraTestResponse
from app.routers.auth import requiere_rol, ROL_ADMIN
from app.services import rtsp

# El propio OpenCV (no solo ffmpeg) escribe warnings de conexión a stderr por su
# cuenta; nunca incluyen la URL completa (solo host/hostname), pero de todos
# modos conviene no dejar pasar el ruido de cada cámara caída como si fuera un
# problema del backend.
cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)

# Configuración de cámaras: solo admin en todos los verbos, incluido el GET
# (T26-116, docs/roles-permisos.md). El listado también queda restringido porque
# la respuesta expone la topología de red del local — host, puerto y usuario de
# cada cámara — y eso no es información para cualquier rol autenticado.
router = APIRouter(dependencies=[Depends(requiere_rol(ROL_ADMIN))])


def _obtener(db: Session, camara_id: int) -> Camara:
    camara = db.query(Camara).options(joinedload(Camara.sector)).filter(Camara.id == camara_id).first()
    if not camara:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")
    return camara


def _validar_sector(db: Session, sector_id: Optional[int]) -> None:
    if sector_id is not None and not db.query(Sector).filter(Sector.id == sector_id).first():
        raise HTTPException(status_code=400, detail="El sector indicado no existe")


def _validar_nombre_libre(db: Session, nombre: str, excluir_id: Optional[int] = None) -> None:
    # La base no tiene UNIQUE sobre camaras.nombre (T26-125), así que la unicidad
    # se controla acá. Sin respaldo del motor: dos altas simultáneas con el mismo
    # nombre podrían pasar las dos.
    query = db.query(Camara).filter(Camara.nombre == nombre)
    if excluir_id is not None:
        query = query.filter(Camara.id != excluir_id)
    if query.first():
        raise HTTPException(
            status_code=409, detail=f"Ya existe una cámara con el nombre «{nombre}» (puede estar inactiva)"
        )


def _refrescar(db: Session, camara: Camara) -> Camara:
    db.refresh(camara)
    db.refresh(camara, attribute_names=["sector"])
    return camara


@router.get("/", response_model=list[CamaraResponse])
def listar_camaras(
    sector_id: Optional[int] = Query(None),
    incluir_inactivas: bool = Query(False),
    db: Session = Depends(get_db),
):
    query = db.query(Camara).options(joinedload(Camara.sector))
    if not incluir_inactivas:
        query = query.filter(Camara.activa == True)  # noqa: E712
    if sector_id is not None:
        query = query.filter(Camara.sector_id == sector_id)
    return query.order_by(Camara.id).all()


@router.get("/{camara_id}", response_model=CamaraResponse)
def obtener_camara(camara_id: int, db: Session = Depends(get_db)):
    return _obtener(db, camara_id)


@router.post("/", response_model=CamaraResponse, status_code=status.HTTP_201_CREATED)
def crear_camara(datos: CamaraCreate, db: Session = Depends(get_db)):
    _validar_sector(db, datos.sector_id)
    _validar_nombre_libre(db, datos.nombre)
    camara = Camara(**datos.model_dump())
    db.add(camara)
    db.commit()
    return _refrescar(db, camara)


@router.patch("/{camara_id}", response_model=CamaraResponse)
def actualizar_camara(camara_id: int, datos: CamaraUpdate, db: Session = Depends(get_db)):
    camara = _obtener(db, camara_id)
    # exclude_unset (y no exclude_none como en mesas/sectores) para distinguir
    # "no toques este campo" de un valor mandado a propósito.
    cambios = datos.model_dump(exclude_unset=True)

    if "sector_id" in cambios:
        _validar_sector(db, cambios["sector_id"])
    if "nombre" in cambios:
        _validar_nombre_libre(db, cambios["nombre"], excluir_id=camara.id)

    for campo, valor in cambios.items():
        setattr(camara, campo, valor)
    db.commit()
    return _refrescar(db, camara)


@router.delete("/{camara_id}", status_code=status.HTTP_204_NO_CONTENT)
def desactivar_camara(camara_id: int, db: Session = Depends(get_db)):
    """Baja lógica: la cámara queda inactiva pero la fila no se borra, porque los
    ROI definidos sobre ella la siguen referenciando. Para reactivarla: PATCH con
    activa=true. Los ROI de la cámara NO se desactivan en cascada — quedan como
    estaban para que reactivarla no obligue a redibujarlos."""
    camara = _obtener(db, camara_id)
    camara.activa = False
    db.commit()


@router.post("/{camara_id}/test-conexion", response_model=CamaraTestResponse)
def probar_conexion_camara(
    camara_id: int,
    timeout_segundos: float = Query(rtsp.TIMEOUT_DEFECTO, ge=1, le=15),
    db: Session = Depends(get_db),
):
    """Intenta abrir el stream RTSP de la cámara y devuelve si respondió.

    Siempre contesta 200: que la cámara no conteste no es un error de la API, y
    el diagnóstico viaja en `ok` y `mensaje` para poder mostrarlo tal cual en la
    UI. Ver app/services/rtsp.py para cómo se hace la prueba."""
    camara = _obtener(db, camara_id)
    resultado = rtsp.probar_url(camara.rtsp_url, timeout=timeout_segundos)
    return CamaraTestResponse(
        ok=resultado.ok,
        mensaje=resultado.mensaje,
        codigo_rtsp=resultado.codigo_rtsp,
        latencia_ms=resultado.latencia_ms,
        rtsp_url=camara.rtsp_url_enmascarada,
    )


@router.get("/{camara_id}/snapshot")
def capturar_snapshot(
    camara_id: int,
    timeout_segundos: float = Query(rtsp.TIMEOUT_DEFECTO, ge=1, le=15),
    db: Session = Depends(get_db),
):
    """Captura un frame actual de la cámara para calibrar el ROI (T26-134, RF-12).

    A diferencia de `test-conexion`, acá hace falta decodificar el stream, no
    solo hablar el protocolo: `app/services/rtsp.py` confirma que la cámara
    responde pero no entrega frames. Por eso este endpoint sí usa OpenCV
    (backend FFMPEG, incluido en el propio wheel de opencv-python-headless, sin
    depender de que el sistema tenga ffmpeg instalado aparte).

    El timeout se pasa en el propio constructor de VideoCapture, no con
    `.set()` después de crearlo: seteado después, `CAP_PROP_OPEN_TIMEOUT_MSEC`
    se pierde en silencio (no hay backend abierto todavía que lo retenga) y la
    apertura cae al valor por defecto de OpenCV (~30 s) en vez del que pidió
    quien llama. Verificado a mano contra un host que no responde.
    """
    camara = _obtener(db, camara_id)
    if not camara.activa:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")

    timeout_ms = int(timeout_segundos * 1000)
    parametros = [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms,
    ]
    captura = cv2.VideoCapture(camara.rtsp_url, cv2.CAP_FFMPEG, parametros)
    try:
        if not captura.isOpened():
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"La cámara «{camara.nombre}» no respondió en {timeout_segundos:g} segundos",
            )
        capturado, frame = captura.read()
    finally:
        captura.release()

    if not capturado or frame is None:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"La cámara «{camara.nombre}» abrió el stream pero no se pudo leer un frame",
        )

    codificado, buffer = cv2.imencode(".jpg", frame)
    if not codificado:
        raise HTTPException(
            status_code=500, detail="No se pudo codificar el frame capturado como JPEG"
        )

    return Response(content=buffer.tobytes(), media_type="image/jpeg")
