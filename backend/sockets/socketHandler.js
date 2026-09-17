const { query, getOne, run } = require('../config/database');
const { logAudit } = require('../utils/logger');
const { reorderQueue } = require('../controllers/sessionController');

/**
 * Inicializa Socket.io y el monitor en segundo plano de sesiones
 */
function initSockets(io) {
  io.on('connection', (socket) => {
    // Unirse a sala personal del usuario
    socket.on('join:user', (data) => {
      if (data && data.userId) {
        socket.join(`user_${data.userId}`);
      }
    });

    // Unirse a sala del personal / admin
    socket.on('join:staff', () => {
      socket.join('staff_room');
    });

    socket.on('disconnect', () => {
      // Desconexión limpia
    });
  });

  // Monitor en segundo plano para control y expiración automática de sesiones
  setInterval(async () => {
    try {
      await checkActiveSessions(io);
    } catch (err) {
      console.error('Error en monitor de sesiones:', err.message);
    }
  }, 10000); // Evaluar cada 10 segundos
}

// Registro en memoria de alertas emitidas para no duplicarlas por sesión
const alertsSent = new Map(); // sessionId -> Set(['15', '10', '5', 'expired'])

async function checkActiveSessions(io) {
  const activeSessions = await query(
    `SELECT s.id, s.usuario_id, s.computador_id, s.fecha_inicio, s.tiempo_maximo, s.estado,
            c.nombre AS pc_nombre, u.nombre_completo AS usuario_nombre
     FROM sesiones s
     JOIN computadores c ON s.computador_id = c.id
     JOIN usuarios u ON s.usuario_id = u.id
     WHERE s.estado IN ('activa', 'proxima_finalizar')`
  );

  if (!activeSessions || activeSessions.length === 0) return;

  const now = new Date();

  // Consultar configuración del sistema
  const config = await getOne('SELECT tiempo_alerta, accion_fin_tiempo FROM configuracion WHERE id = 1');
  const alertThreshold = config ? config.tiempo_alerta : 15;
  const finishAction = config ? config.accion_fin_tiempo : 'finalizar_automatica';

  for (const session of activeSessions) {
    const start = new Date(session.fecha_inicio);
    const elapsedSeconds = Math.max(0, Math.floor((now - start) / 1000));
    const totalMaxSeconds = (session.tiempo_maximo || 60) * 60;
    const remainingSeconds = totalMaxSeconds - elapsedSeconds;
    const remainingMinutes = Math.ceil(remainingSeconds / 60);

    if (!alertsSent.has(session.id)) {
      alertsSent.set(session.id, new Set());
    }
    const sessionAlerts = alertsSent.get(session.id);

    // Alerta de 15 minutos
    if (remainingMinutes <= 15 && remainingMinutes > 10 && !sessionAlerts.has('15')) {
      sessionAlerts.add('15');
      io.to(`user_${session.usuario_id}`).emit('session:alert', {
        type: 'warning',
        minutos: 15,
        message: '🔔 Te quedan 15 minutos de uso.'
      });
    }

    // Alerta de 10 minutos
    if (remainingMinutes <= 10 && remainingMinutes > 5 && !sessionAlerts.has('10')) {
      sessionAlerts.add('10');
      io.to(`user_${session.usuario_id}`).emit('session:alert', {
        type: 'warning',
        minutos: 10,
        message: '⚠️ Atención, te quedan 10 minutos de tiempo.'
      });
    }

    // Alerta crítica de 5 minutos (Próximo a terminar)
    if (remainingMinutes <= 5 && remainingMinutes > 0 && !sessionAlerts.has('5')) {
      sessionAlerts.add('5');
      // Actualizar estado a 'proxima_finalizar'
      await run("UPDATE sesiones SET estado = 'proxima_finalizar' WHERE id = ?", [session.id]);
      await run("UPDATE computadores SET estado = 'proximo_terminar' WHERE id = ?", [session.computador_id]);

      io.to(`user_${session.usuario_id}`).emit('session:alert', {
        type: 'critical',
        minutos: 5,
        message: '🚨 Tu sesión está próxima a terminar. Te quedan solamente 5 minutos.'
      });
      io.emit('pc:updated', { action: 'warning_time', pcId: session.computador_id, estado: 'proximo_terminar' });
    }

    // Tiempo agotado (<= 0)
    if (remainingSeconds <= 0 && !sessionAlerts.has('expired')) {
      sessionAlerts.add('expired');

      if (finishAction === 'finalizar_automatica') {
        // Finalizar automáticamente
        await run(
          `UPDATE sesiones
           SET fecha_fin = datetime('now', 'localtime'),
               tiempo_utilizado = ?,
               estado = 'finalizada'
           WHERE id = ?`,
          [totalMaxSeconds, session.id]
        );

        await run("UPDATE computadores SET estado = 'disponible' WHERE id = ?", [session.computador_id]);

        await logAudit(
          session.usuario_id,
          'EXPIRACION_AUTOMATICA',
          `La sesión #${session.id} en ${session.pc_nombre} finalizó automáticamente al cumplirse el tiempo límite de ${session.tiempo_maximo} min.`
        );

        await run(
          'INSERT INTO notificaciones (usuario_id, titulo, mensaje) VALUES (?, ?, ?)',
          [
            session.usuario_id,
            'Tiempo de uso terminado',
            `Tu tiempo de uso en ${session.pc_nombre} ha finalizado. El equipo ha sido liberado automáticamente.`
          ]
        );

        alertsSent.delete(session.id);

        io.to(`user_${session.usuario_id}`).emit('session:ended', {
          reason: 'timeout',
          message: '⛔ Tu tiempo de uso ha terminado. El computador ha sido liberado.'
        });

        io.emit('pc:updated', {
          action: 'session_ended',
          pcId: session.computador_id,
          estado: 'disponible',
          freedPC: session.pc_nombre
        });

        io.emit('queue:updated');

        // Notificar al siguiente en fila si existe
        const nextInQueue = await getOne(
          `SELECT l.id, l.usuario_id, u.nombre_completo
           FROM lista_espera l
           JOIN usuarios u ON l.usuario_id = u.id
           WHERE l.estado = 'esperando'
           ORDER BY l.posicion ASC LIMIT 1`
        );
        if (nextInQueue) {
          io.emit('queue:pc_available', {
            pcId: session.computador_id,
            pcName: session.pc_nombre,
            nextUserId: nextInQueue.usuario_id,
            nextUserName: nextInQueue.nombre_completo
          });
        }
      } else {
        // Notificar al funcionario
        io.to('staff_room').emit('session:overtime', {
          sessionId: session.id,
          pcName: session.pc_nombre,
          userName: session.usuario_nombre
        });
      }
    }
  }
}

module.exports = {
  initSockets
};
