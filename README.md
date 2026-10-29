# 🖥️ BiblioTiempoDoce — Biblioteca Pública 12 de Octubre

Sistema web en tiempo real para la gestión, asignación de turnos y control de tiempo de los computadores de la **Biblioteca Pública 12 de Octubre** (Comuna 6, Medellín).

---

## ✨ Características Principales

- **Pantalla Pública en Tiempo Real**: Visualización en vivo del estado de los 12 computadores de la biblioteca (`Disponible`, `Ocupado`, `Próximo a terminar`, `Fuera de servicio`).
- **Portal de Usuario (Comunidad)**:
  - Registro e inicio de sesión con documento o correo electrónico.
  - Inicio voluntario de sesión en equipos libres con temporizador circular en vivo.
  - Ingreso y seguimiento en la **Fila de Espera Digital** (FIFO) cuando todos los equipos están ocupados.
  - Historial personal de sesiones y centro de notificaciones.
- **Portal de Funcionario (Sala de Control)**:
  - Supervisión en vivo de todos los equipos y tiempos restantes.
  - Asignación manual de sesiones por documento o asignación directa del siguiente turno en la fila de espera.
  - Extensión de tiempo (`+15 min`, `+30 min`), finalización forzada y cambio a estado de mantenimiento.
- **Consola Super Administrador**:
  - Tablero de indicadores (KPIs) y analítica visual con **Chart.js** (demanda por hora, equipos más usados y evolución semanal).
  - Gestión completa (CRUD) de computadores y usuarios/roles.
  - Configuración global de parámetros operativos (tiempo máximo por sesión, alertas previas, reglas de fila).
  - Registro de auditoría y exportación de reportes en CSV.
- **Persistencia Híbrida Automática**: Soporta **MySQL** como motor principal y cambia automáticamente a **SQLite** local (`backend/database/database.sqlite`) si MySQL no está disponible, sin requerir configuración adicional.

---

## 🛠️ Tecnologías Utilizadas

- **Backend**: Node.js, Express, Socket.io (WebSockets en tiempo real), JSON Web Tokens (`jsonwebtoken`), `bcryptjs`.
- **Base de Datos**: MySQL (`mysql2`) / SQLite3 (`sqlite3`) con inicialización y semillas automáticas (`seed`).
- **Frontend**: HTML5 modular por componentes, CSS3 con variables de tema claro institucional, JavaScript Vanilla (ES6+), FontAwesome 6 y Chart.js.
- **Testing**: Suite de pruebas automatizadas con `node:test` y base de datos SQLite en memoria (`:memory:`).

---

## 📂 Estructura del Proyecto

```text
├── backend/
│   ├── config/          # Conexión híbrida MySQL/SQLite, creación de tablas y semillas
│   ├── controllers/     # Lógica de negocio (auth, pcs, sessions, queue, admin, notifications)
│   ├── database/        # Esquema SQL y archivo local SQLite
│   ├── middlewares/     # Autenticación JWT y control de acceso por roles
│   ├── routes/          # Definición de rutas de la API REST
│   ├── sockets/         # Eventos Socket.io y monitor automático de expiración de sesiones
│   ├── utils/           # Registro de auditoría (logger)
│   └── server.js        # Punto de entrada del servidor HTTP + WebSockets
├── frontend/
│   ├── components/      # Vistas y modales modulares HTML
│   ├── css/             # Hoja de estilos principal (Tema Claro Institucional)
│   ├── js/              # Módulos cliente (API, Auth, Socket, Paneles por rol)
│   └── index.html       # Contenedor SPA principal
├── tests/
│   └── backend.test.js  # Suite de 27 pruebas de integración de la API REST
└── package.json
```

---

## 🚀 Instalación y Ejecución

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Iniciar el servidor**:
   ```bash
   npm start
   ```
   *(En Windows también puedes ejecutar `iniciar.bat` para levantar el servidor y abrir el navegador automáticamente).*

3. **Abrir en el navegador**:
   ```text
   http://localhost:3000
   ```

4. **Ejecutar la suite de pruebas automatizadas**:
   ```bash
   npm test
   ```

---

## 🔑 Credenciales de Acceso por Defecto

El sistema crea automáticamente usuarios de demostración al iniciar por primera vez. Puedes ingresar con el **Documento** o el **Correo**, usando la contraseña **`123456`**:

| Rol / Portal | Nombre | Documento | Correo | Contraseña |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Administrador General 12 | `1001` | `admin@biblioteca12.gov.co` | `123456` |
| **Funcionario** | Carlos Gómez (Funcionario) | `2002` | `funcionario@biblioteca12.gov.co` | `123456` |
| **Usuario** | Juan Pérez | `3003` | `juan.perez@email.com` | `123456` |
| **Usuario** | María Gómez | `3004` | `maria.gomez@email.com` | `123456` |
| **Usuario** | Carlos Rodríguez | `3005` | `carlos.rodriguez@email.com` | `123456` |

---

## 📡 Principales Endpoints de la API

- `GET /api/health` — Estado del servidor.
- `POST /api/auth/login` | `POST /api/auth/register` | `GET /api/auth/profile` — Autenticación y perfil.
- `GET /api/pcs` | `GET /api/pcs/available` | `POST /api/pcs` | `PATCH /api/pcs/:id/status` — Gestión de computadores.
- `POST /api/sessions/start` | `POST /api/sessions/:id/extend` | `POST /api/sessions/:id/end` — Control de sesiones.
- `POST /api/queue/join` | `POST /api/queue/leave` | `POST /api/queue/assign` — Lista de espera digital.
- `GET /api/admin/kpis` | `GET /api/admin/statistics` | `GET /api/admin/audit-logs` | `GET /api/admin/reports` — Administración y analítica.
