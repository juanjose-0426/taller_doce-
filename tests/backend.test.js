process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.SQLITE_FILE = ':memory:';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { initDatabase, closeDatabase } = require('../backend/config/database');
const { server, io } = require('../backend/server');
const { initSockets } = require('../backend/sockets/socketHandler');

let baseUrl = '';
let adminToken = '';
let staffToken = '';
let userToken = '';
let secondUserToken = '';
let createdPcId = null;
let activeSessionId = null;

/**
 * Helper para realizar peticiones HTTP JSON a la API
 */
async function apiRequest(method, route, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

describe('BiblioTiempoDoce - Suite de Pruebas Automatizadas del Backend', () => {
  before(async () => {
    await initDatabase();
    initSockets(io);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => io.close(() => resolve()));
    if (server.listening) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    await closeDatabase();
  });

  describe('1. Estado del Servidor (/api/health)', () => {
    it('debe responder 200 y estado online en GET /api/health', async () => {
      const { status, data } = await apiRequest('GET', '/api/health');
      assert.equal(status, 200);
      assert.equal(data.status, 'online');
      assert.equal(data.app, 'BiblioTiempoDoce');
    });

    it('debe responder 404 para rutas de API inexistentes', async () => {
      const { status, data } = await apiRequest('GET', '/api/ruta-que-no-existe');
      assert.equal(status, 404);
      assert.equal(data.success, false);
    });
  });

  describe('2. Autenticación y Perfil (/api/auth)', () => {
    it('debe autenticar correctamente al Super Administrador', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/login', {
        body: {
          identificador: 'admin@biblioteca12.gov.co',
          password: '123456',
          portal: 'superadmin'
        }
      });
      assert.equal(status, 200);
      assert.equal(data.success, true);
      assert.ok(data.token);
      assert.equal(data.user.rol_nombre, 'superadmin');
      adminToken = data.token;
    });

    it('debe autenticar correctamente al Funcionario', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/login', {
        body: {
          identificador: '2002',
          password: '123456',
          portal: 'funcionario'
        }
      });
      assert.equal(status, 200);
      assert.equal(data.success, true);
      assert.ok(data.token);
      assert.equal(data.user.rol_nombre, 'funcionario');
      staffToken = data.token;
    });

    it('debe autenticar correctamente a un Usuario lector', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/login', {
        body: {
          identificador: '3003',
          password: '123456'
        }
      });
      assert.equal(status, 200);
      assert.equal(data.success, true);
      assert.ok(data.token);
      assert.equal(data.user.rol_nombre, 'usuario');
      userToken = data.token;
    });

    it('debe rechazar el ingreso de un usuario normal al portal de superadmin (403)', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/login', {
        body: {
          identificador: '3003',
          password: '123456',
          portal: 'superadmin'
        }
      });
      assert.equal(status, 403);
      assert.equal(data.success, false);
    });

    it('debe rechazar credenciales inválidas (401)', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/login', {
        body: {
          identificador: '3003',
          password: 'clave_incorrecta'
        }
      });
      assert.equal(status, 401);
      assert.equal(data.success, false);
    });

    it('debe registrar un nuevo usuario y devolver su token JWT (201)', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/register', {
        body: {
          nombre_completo: 'Laura Prueba',
          documento: '900900',
          correo: 'laura.prueba@email.com',
          password: 'password123'
        }
      });
      assert.equal(status, 201);
      assert.equal(data.success, true);
      assert.ok(data.token);
      assert.equal(data.user.documento, '900900');
      secondUserToken = data.token;
    });

    it('debe impedir el registro con documento duplicado (409)', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/register', {
        body: {
          nombre_completo: 'Usuario Duplicado',
          documento: '900900',
          correo: 'otro@email.com',
          password: 'password123'
        }
      });
      assert.equal(status, 409);
      assert.equal(data.success, false);
    });

    it('debe obtener y actualizar el perfil del usuario autenticado', async () => {
      const profileRes = await apiRequest('GET', '/api/auth/profile', { token: userToken });
      assert.equal(profileRes.status, 200);
      assert.equal(profileRes.data.user.documento, '3003');

      const updateRes = await apiRequest('PUT', '/api/auth/profile', {
        token: userToken,
        body: { nombre_completo: 'Juan Pérez Actualizado' }
      });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.data.user.nombre_completo, 'Juan Pérez Actualizado');
    });
  });

  describe('3. Gestión de Computadores (/api/pcs)', () => {
    it('debe listar los 12 computadores iniciales públicamente', async () => {
      const { status, data } = await apiRequest('GET', '/api/pcs');
      assert.equal(status, 200);
      assert.equal(data.success, true);
      assert.equal(data.data.length, 12);
    });

    it('debe listar los computadores disponibles para usuarios autenticados', async () => {
      const { status, data } = await apiRequest('GET', '/api/pcs/available', { token: userToken });
      assert.equal(status, 200);
      assert.equal(data.success, true);
      assert.equal(data.data.length, 11); // 11 disponibles, PC-12 fuera de servicio
    });

    it('debe impedir que un usuario sin rol superadmin cree un computador (403)', async () => {
      const { status, data } = await apiRequest('POST', '/api/pcs', {
        token: userToken,
        body: {
          nombre: 'PC-13',
          numero: 13,
          ubicacion: 'Sala Principal'
        }
      });
      assert.equal(status, 403);
      assert.equal(data.success, false);
    });

    it('debe permitir al superadmin crear, editar, cambiar estado y eliminar un computador', async () => {
      // Crear PC-13
      const createRes = await apiRequest('POST', '/api/pcs', {
        token: adminToken,
        body: {
          nombre: 'PC-13',
          numero: 13,
          ubicacion: 'Sala General',
          descripcion: 'Equipo de prueba'
        }
      });
      assert.equal(createRes.status, 201);
      assert.equal(createRes.data.success, true);
      createdPcId = createRes.data.pcId;

      // Editar PC-13
      const updateRes = await apiRequest('PUT', `/api/pcs/${createdPcId}`, {
        token: adminToken,
        body: {
          nombre: 'PC-13-PRO',
          ubicacion: 'Sala Multimedia'
        }
      });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.data.success, true);

      // Cambiar estado con funcionario
      const statusRes = await apiRequest('PATCH', `/api/pcs/${createdPcId}/status`, {
        token: staffToken,
        body: { estado: 'fuera_servicio' }
      });
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.data.success, true);

      // Eliminar PC-13
      const deleteRes = await apiRequest('DELETE', `/api/pcs/${createdPcId}`, {
        token: adminToken
      });
      assert.equal(deleteRes.status, 200);
      assert.equal(deleteRes.data.success, true);
    });
  });

  describe('4. Sesiones de Uso (/api/sessions)', () => {
    it('debe iniciar una sesión en un computador disponible y marcarlo como ocupado', async () => {
      const { status, data } = await apiRequest('POST', '/api/sessions/start', {
        token: userToken,
        body: { computador_id: 1, tiempo_maximo: 45 }
      });
      assert.equal(status, 201);
      assert.equal(data.success, true);
      assert.ok(data.sessionId);
      assert.equal(data.tiempoMaximo, 45);
      activeSessionId = data.sessionId;

      // Verificar que PC-01 ahora está ocupado
      const pcRes = await apiRequest('GET', '/api/pcs/1', { token: userToken });
      assert.equal(pcRes.status, 200);
      assert.equal(pcRes.data.data.estado, 'ocupado');
    });

    it('debe impedir que el mismo usuario inicie una segunda sesión simultánea (400)', async () => {
      const { status, data } = await apiRequest('POST', '/api/sessions/start', {
        token: userToken,
        body: { computador_id: 2 }
      });
      assert.equal(status, 400);
      assert.equal(data.success, false);
    });

    it('debe impedir iniciar sesión en un computador ya ocupado o fuera de servicio (400)', async () => {
      // PC 1 está ocupado
      const occupiedRes = await apiRequest('POST', '/api/sessions/start', {
        token: secondUserToken,
        body: { computador_id: 1 }
      });
      assert.equal(occupiedRes.status, 400);

      // PC 12 está fuera de servicio
      const maintenanceRes = await apiRequest('POST', '/api/sessions/start', {
        token: secondUserToken,
        body: { computador_id: 12 }
      });
      assert.equal(maintenanceRes.status, 400);
    });

    it('debe consultar la sesión activa del usuario con temporizadores en vivo', async () => {
      const { status, data } = await apiRequest('GET', '/api/sessions/my-active', {
        token: userToken
      });
      assert.equal(status, 200);
      assert.equal(data.hasActiveSession, true);
      assert.equal(data.session.id, activeSessionId);
      assert.equal(data.session.computador_id, 1);
    });

    it('debe permitir al funcionario extender el tiempo de una sesión activa', async () => {
      const { status, data } = await apiRequest('POST', `/api/sessions/${activeSessionId}/extend`, {
        token: staffToken,
        body: { minutosAdicionales: 15 }
      });
      assert.equal(status, 200);
      assert.equal(data.success, true);
      assert.equal(data.nuevoMaximo, 60);
    });

    it('debe finalizar la sesión activa y liberar el computador a disponible', async () => {
      const { status, data } = await apiRequest('POST', `/api/sessions/${activeSessionId}/end`, {
        token: userToken
      });
      assert.equal(status, 200);
      assert.equal(data.success, true);

      // Verificar que PC-01 volvió a disponible
      const pcRes = await apiRequest('GET', '/api/pcs/1', { token: userToken });
      assert.equal(pcRes.data.data.estado, 'disponible');

      // Verificar historial del usuario
      const historyRes = await apiRequest('GET', '/api/sessions/my-history', { token: userToken });
      assert.equal(historyRes.status, 200);
      assert.ok(historyRes.data.data.length >= 1);
    });
  });

  describe('5. Lista de Espera / Cola (/api/queue)', () => {
    it('debe permitir a un usuario sin sesión activa unirse a la lista de espera', async () => {
      const { status, data } = await apiRequest('POST', '/api/queue/join', {
        token: secondUserToken
      });
      assert.equal(status, 201);
      assert.equal(data.success, true);
      assert.equal(data.posicion, 1);
    });

    it('debe impedir que el mismo usuario se anote dos veces en la cola (400)', async () => {
      const { status, data } = await apiRequest('POST', '/api/queue/join', {
        token: secondUserToken
      });
      assert.equal(status, 400);
      assert.equal(data.success, false);
    });

    it('debe consultar la posición actual del usuario en la cola', async () => {
      const { status, data } = await apiRequest('GET', '/api/queue/my-position', {
        token: secondUserToken
      });
      assert.equal(status, 200);
      assert.equal(data.inQueue, true);
      assert.equal(data.data.posicion, 1);
    });

    it('debe permitir al funcionario asignar al siguiente usuario en cola a un PC disponible', async () => {
      const { status, data } = await apiRequest('POST', '/api/queue/assign', {
        token: staffToken,
        body: { computador_id: 2 }
      });
      assert.equal(status, 200);
      assert.equal(data.success, true);
      assert.ok(data.sessionId);

      // Finalizar la sesión asignada para dejar limpio el estado
      await apiRequest('POST', `/api/sessions/${data.sessionId}/end`, {
        token: staffToken
      });
    });

    it('debe permitir a un usuario ingresar y retirarse voluntariamente de la cola', async () => {
      const joinRes = await apiRequest('POST', '/api/queue/join', { token: userToken });
      assert.equal(joinRes.status, 201);

      const leaveRes = await apiRequest('POST', '/api/queue/leave', { token: userToken });
      assert.equal(leaveRes.status, 200);
      assert.equal(leaveRes.data.success, true);
    });
  });

  describe('6. Notificaciones (/api/notifications) y Administración (/api/admin)', () => {
    it('debe listar y marcar notificaciones como leídas', async () => {
      const listRes = await apiRequest('GET', '/api/notifications', { token: userToken });
      assert.equal(listRes.status, 200);
      assert.equal(listRes.data.success, true);
      assert.ok(listRes.data.data.length > 0);

      const readAllRes = await apiRequest('PATCH', '/api/notifications/read-all', { token: userToken });
      assert.equal(readAllRes.status, 200);
      assert.equal(readAllRes.data.success, true);
    });

    it('debe retornar KPIs, estadísticas, configuración, usuarios y auditoría al Super Admin', async () => {
      const kpisRes = await apiRequest('GET', '/api/admin/kpis', { token: adminToken });
      assert.equal(kpisRes.status, 200);
      assert.equal(kpisRes.data.data.totalComputadores, 12);

      const statsRes = await apiRequest('GET', '/api/admin/statistics', { token: adminToken });
      assert.equal(statsRes.status, 200);
      assert.equal(statsRes.data.success, true);

      const configRes = await apiRequest('GET', '/api/admin/config', { token: adminToken });
      assert.equal(configRes.status, 200);
      assert.equal(configRes.data.data.tiempo_maximo, 60);

      const usersRes = await apiRequest('GET', '/api/admin/users', { token: adminToken });
      assert.equal(usersRes.status, 200);
      assert.ok(usersRes.data.data.length >= 6);

      const logsRes = await apiRequest('GET', '/api/admin/audit-logs', { token: adminToken });
      assert.equal(logsRes.status, 200);
      assert.ok(logsRes.data.data.length > 0);

      const reportsRes = await apiRequest('GET', '/api/admin/reports', { token: adminToken });
      assert.equal(reportsRes.status, 200);
      assert.equal(reportsRes.data.success, true);
    });
  });
});

