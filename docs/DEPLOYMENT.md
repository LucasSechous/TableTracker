# Manual de despliegue

**Proyecto:** TableTracker — Sistema de monitoreo del estado de mesas mediante visión por computadora
**Repositorio:** https://github.com/LucasSechous/TableTracker
**Versión del documento:** 1.0 — 3 de octubre de 2026

---

## 1. Introducción

### 1.1 Propósito

Este documento describe el procedimiento completo de instalación y puesta en marcha de TableTracker sobre un entorno nuevo, desde la obtención del código fuente hasta la verificación funcional del sistema integrado. Está dirigido a personal técnico sin conocimiento previo del proyecto.

### 1.2 Alcance

El procedimiento cubre los cuatro componentes del sistema: la base de datos relacional, la interfaz de programación de aplicaciones (API), la interfaz web y el módulo de visión por computadora. No cubre la configuración de infraestructura de red, la instalación física de cámaras ni el despliegue sobre plataformas de nube específicas.

### 1.3 Arquitectura de referencia

El sistema se compone de cuatro procesos independientes, descritos en detalle en `docs/ARQUITECTURA.md`:

**Tabla 1**

*Componentes del sistema y responsabilidad de cada uno*

| Componente | Directorio | Responsabilidad |
|---|---|---|
| Base de datos | `database/` | Persistencia y versionado del esquema |
| API | `backend/` | Lógica de negocio, autenticación y acceso a datos |
| Interfaz web | `frontend/` | Visualización del salón y operación |
| Módulo de visión | `vision-module/` | Captura, detección y actualización automática de estados |

*Nota.* Elaboración propia.

---

## 2. Requisitos previos

**Tabla 2**

*Requisitos de software verificados*

| Componente | Versión verificada | Observación |
|---|---|---|
| Python (API) | 3.14.5 | Entorno virtual propio en `backend/venv` |
| Python (módulo de visión) | 3.12.10 | Entorno virtual propio en `vision-module/venv` |
| Node.js | 24.11.1 | — |
| npm | 11.6.2 | — |
| PostgreSQL | 16 o superior | Local o gestionado |
| Cámara IP | Protocolo RTSP | TP-Link Tapo C310 en el entorno de referencia |

*Nota.* Elaboración propia. Las versiones indicadas son las verificadas sobre el entorno de desarrollo.

La API y el módulo de visión **requieren intérpretes de Python distintos y entornos virtuales separados**. El módulo de visión depende de `ultralytics`, `opencv-python` y `numpy`, cuyas distribuciones compiladas no acompañan todavía a la versión 3.14 del intérprete.

Sobre Microsoft Windows debe habilitarse previamente el soporte de rutas extensas. Sin esta configuración, la instalación de dependencias falla al superar el límite histórico de 260 caracteres.

---

## 3. Obtención del código fuente

```bash
git clone https://github.com/LucasSechous/TableTracker.git
cd TableTracker
```

---

## 4. Base de datos

Debe disponerse de una base PostgreSQL vacía. No es necesario crear tablas: el esquema lo aplica Alembic en el apartado 5.4.

Para un entorno local mediante contenedor:

```bash
docker run -d --name tabletracker-db \
  -e POSTGRES_USER=tabletracker \
  -e POSTGRES_PASSWORD=<contraseña> \
  -e POSTGRES_DB=tabletracker \
  -p 5432:5432 postgres:16-alpine
```

---

## 5. Interfaz de programación de aplicaciones (API)

### 5.1 Entorno virtual e instalación de dependencias

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # GNU/Linux y macOS: source venv/bin/activate
pip install -r requirements.txt
```

### 5.2 Generación de claves criptográficas

El sistema emplea dos claves independientes. Esta separación es deliberada: el compromiso de una no habilita el acceso protegido por la otra.

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from app.services import cifrado; print(cifrado.generar_clave())"
```

La primera firma los testigos de sesión (JWT). La segunda, en formato Fernet, cifra las credenciales de acceso a las cámaras almacenadas en la base.

### 5.3 Archivo de configuración

Copiar `backend/.env.example` a `backend/.env` y completar:

```ini
DATABASE_URL=postgresql://tabletracker:<contraseña>@127.0.0.1:5432/tabletracker
SECRET_KEY=<clave generada en primer término>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
CAMARA_ENCRYPTION_KEYS=<clave Fernet>
CORS_ORIGINS=http://localhost:5173
```

**Tabla 3**

*Variables de configuración obligatorias de la API*

| Variable | Función | Consecuencia de su ausencia |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión | El servicio no inicia |
| `SECRET_KEY` | Firma de testigos de sesión | La autenticación no opera |
| `CAMARA_ENCRYPTION_KEYS` | Cifrado de credenciales RTSP | No pueden leerse ni registrarse contraseñas de cámaras |
| `CORS_ORIGINS` | Orígenes autorizados | La interfaz web no puede consumir la API |

*Nota.* Elaboración propia. `CORS_ORIGINS` admite varios orígenes separados por coma, sin espacios ni barra final.

### 5.4 Aplicación del esquema

Desde la raíz del repositorio:

```bash
alembic -c database/alembic.ini upgrade head
```

El procedimiento aplica once revisiones sucesivas, desde `e72cc6e493dc` hasta `7db753755bb9`, y deja la base operativa. Verificación:

```bash
alembic -c database/alembic.ini current    # resultado esperado: 7db753755bb9 (head)
```

La gestión del esquema se documenta en `database/README.md`. Toda modificación posterior debe realizarse mediante una revisión nueva; la alteración manual de la base deja los entornos desalineados entre sí.

---

## 6. Usuario administrador inicial

El registro de usuarios exige una sesión administrativa previa, de modo que el primer usuario no puede crearse a través de la API. Se emplea el guion de arranque:

```bash
cd backend
ADMIN_EMAIL=admin@<dominio>.com ADMIN_PASSWORD=<contraseña> python -m app.seed_admin
```

La operación es idempotente: si la dirección ya existe, no realiza modificación alguna.

La dirección de correo se valida sintáctica y semánticamente. Los dominios de uso reservado conforme al RFC 2606 —`.test`, `.example`, `.invalid`, `.localhost`— son rechazados con un error de validación, por lo que debe emplearse un dominio de primer nivel convencional aun en entornos de prueba.

---

## 7. Puesta en marcha de la API

```bash
cd backend
venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Tabla 4**

*Comprobaciones posteriores al arranque*

| Comprobación | Resultado esperado |
|---|---|
| `http://127.0.0.1:8000/docs` | Documentación interactiva de la API |
| `POST /auth/login` con las credenciales del apartado 6 | Código 200 y testigo de sesión |
| `GET /configuracion` con el testigo obtenido | Código 200 |

*Nota.* Elaboración propia. Un código 404 en `GET /configuracion` indica que el esquema no alcanzó la revisión `7db753755bb9`; corresponde reejecutar el apartado 5.4.

---

## 8. Interfaz web

```bash
cd frontend
npm install
```

Copiar `frontend/.env.example` a `frontend/.env`:

```ini
VITE_API_URL=http://127.0.0.1:8000
```

Ejecución en desarrollo:

```bash
npm run dev            # puerto 5173
```

Generación del paquete de producción:

```bash
npm run build          # resultado en frontend/dist/
```

El valor de `VITE_API_URL` se incorpora al paquete durante la compilación. Toda modificación posterior de esa dirección exige regenerar el paquete.

---

## 9. Carga inicial del salón

Desde la interfaz web, autenticado con el usuario del apartado 6, debe registrarse en el siguiente orden:

1. **Sector.** Agrupación física del salón; condiciona la ubicación de las mesas.
2. **Mesas.** Cada mesa pertenece a un sector y es única dentro de él.
3. **Cámara.** Requiere denominación, dirección RTSP, credenciales y sector asociado. El formulario permite verificar la conectividad antes de confirmar el registro.

---

## 10. Módulo de visión por computadora

### 10.1 Entorno virtual e instalación

```bash
cd vision-module
python -m venv venv            # intérprete 3.12; véase el apartado 2
venv\Scripts\activate
pip install -r requirements.txt
```

### 10.2 Usuario técnico

El módulo se autentica contra la API con credenciales propias y renueva su testigo de sesión automáticamente. Debe crearse desde la pantalla de administración de usuarios un usuario cuyo rol permita **consultar** los recursos de cámaras y regiones de interés, además de modificar el estado de las mesas.

### 10.3 Archivo de configuración

Copiar `vision-module/.env.example` a `vision-module/.env`. El archivo de ejemplo documenta cada variable; la configuración mínima es:

```ini
BACKEND_URL=http://localhost:8000
BACKEND_EMAIL=<usuario técnico>
BACKEND_PASSWORD=<contraseña>
SECTOR_ID=<identificador del sector>
CAMARA_PASSWORD=<contraseña del flujo RTSP>
YOLO_MODEL_PATH=models/yolov8s.pt
YOLO_IMGSZ=960
```

La contraseña del flujo RTSP se configura localmente y no se transmite por la red: la API devuelve la dirección con la credencial enmascarada de forma deliberada. Los pesos del modelo de detección se descargan automáticamente en la primera ejecución y se almacenan en `vision-module/models/`, directorio excluido del control de versiones.

### 10.4 Calibración de regiones de interés

Previamente a la primera ejecución debe definirse, desde la pantalla de calibración de la interfaz web, el polígono correspondiente a cada mesa sobre la imagen real de la cámara. Sin estas regiones el módulo carece de criterio para asociar las detecciones a una mesa determinada y no produce actualización alguna.

### 10.5 Ejecución

```bash
cd vision-module
venv\Scripts\python.exe -m app.main
```

---

## 11. Verificación funcional del sistema integrado

**Tabla 5**

*Secuencia de verificación de extremo a extremo*

| Paso | Acción | Resultado esperado |
|---|---|---|
| 1 | Ocupar una mesa con región de interés calibrada | Transición a *ocupada* tras el período de confirmación sostenida |
| 2 | Desocupar la mesa | Transición a *pendiente de limpieza* |
| 3 | Confirmar la limpieza desde la interfaz | Transición a *libre* |
| 4 | Consultar `GET /historial` | Tres registros, con su origen respectivo |

*Nota.* Elaboración propia. El período de confirmación corresponde al parámetro `CONFIRMACION_SEGUNDOS`, de seis segundos por omisión. La transición a *libre* del paso 3 requiere intervención humana por diseño: el módulo de visión no la realiza automáticamente.

---

## 12. Incidencias frecuentes

**Tabla 6**

*Incidencias habituales durante la instalación*

| Manifestación | Causa | Resolución |
|---|---|---|
| `GET /configuracion` responde 404 | Esquema anterior a `7db753755bb9` | Apartado 5.4 |
| Error de validación al crear el usuario administrador | Dominio de uso reservado | Apartado 6 |
| El módulo no actualiza el estado de las mesas | Regiones de interés sin calibrar, o rol del usuario técnico sin permiso de consulta | Apartados 10.2 y 10.4 |
| Una modificación en `config.py` no surte efecto | El archivo `.env` del módulo prevalece sobre los valores por omisión | Revisar `vision-module/.env` |
| Pérdida de conectividad con la cámara | Asignación dinámica de dirección IP | Reservar la dirección en el encaminador o actualizar el registro de la cámara |
| Fallo de instalación de dependencias en Windows | Límite de longitud de ruta | Apartado 2 |

*Nota.* Elaboración propia.

---

## 13. Documentación complementaria

| Documento | Contenido |
|---|---|
| `docs/ARQUITECTURA.md` | Arquitectura y responsabilidades de cada componente |
| `database/README.md` | Gestión y versionado del esquema |
| `docs/camaras-roi.md` | Modelo de cámaras y regiones de interés |
| `docs/roles-permisos.md` | Matriz de permisos por rol |
| `docs/vision-loop.md` | Ciclo de detección del módulo de visión |
| `docs/banco-pruebas-vision.md` | Procedimiento de medición de la detección |
| `docs/privacidad-vision.md` | Tratamiento de las imágenes captadas |
| `e2e/README.md` | Ejecución de la suite de pruebas automatizadas |
