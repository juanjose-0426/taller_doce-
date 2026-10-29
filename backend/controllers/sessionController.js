const { query, getOne, run } = require('../config/database');
const { logAudit } = require('../utils/logger');

/**
 * Iniciar una sesión de uso de computador
 */
async function startSession(req, res) {
  try {
    const { computador_id, documento_usuario } = req.body;

    // Resuelve usuario_id: el funcionario puede pasar documento_usuario para buscar al visitante
    let usuario_id = req.body.usuario_id || req.user.id;
    if (documento_usuario && (req.user.rol_nombre === 'funcionario' || req.user.rol_nombre === 'superadmin')) {
      const usuarioEncontrado = await getOne(
        "SELECT id FROM usuarios WHERE documento = ? AND estado = 'activo'",
        [documento_usuario]
      );
      if (!usuarioEncontrado) {
        return res.status(404).json({
          success: false,
          message: `No se encontro ningun usuario activo con el documento "${documento_usuario}". Verificalo o registralo primero.`
        });
      }
      usuario_id = usuarioEncontrado.id;
    }

    if (!computador_id) {
      return res.status(400).json({ success: false, message: 'Se requiere el ID del computador.' });
    }

    // Regla 1: Verificar si el usuario ya tiene una sesión activa
    const userActiveSession = await getOne(
      "SELECT id, computador_id FROM sesiones WHERE usuario_id = ? AND estado IN ('activa', 'proxima_finalizar')",
      [usuario_id]
    );
    if (userActiveSession) {
      return res.status(400).json({
        success: false,
        message: 'El usuario ya cuenta con una sesión activa en otro computador. Debe finalizarla primero.'
      });
    }

    // Regla 2 y 4: Verificar estado del computador
    const pc = await getOne('SELECT * FROM computadores WHERE id = ?', [computador_id]);
    if (!pc) {
      return res.status(404).json({ success: false, message: 'El computador solicitado no existe.' });
    }

    if (pc.estado === 'fuera_servicio') {
      return res.status(400).json({
        success: false,
        message: 'Este computador se encuentra fuera de servicio por mantenimiento. Seleccione otro equipo.'
      });
    }

    if (pc.estado === 'ocupado') {
      return res.status(400).json({
        success: false,
        message: 'El computador ya se encuentra ocupado por otro usuario.'
      });
    }

    // Obtener tiempo maximo: primero del request body, luego de la config del sistema
    const config = await getOne('SELECT tiempo_maximo FROM configuracion WHERE id = 1');
    const tiempoMaximo = parseInt(req.body.tiempo_maximo, 10) || (config ? config.tiempo_maximo : 60);

    // Crear la sesion. NOW() es normalizado automaticamente a datetime('now','localtime') en SQLite.
    const result = await run(
      `INSERT INTO sesiones (usuario_id, computador_id, fecha_inicio, tiempo_maximo, tiempo_utilizado, estado)
       VALUES (?, ?, NOW(), ?, 0, 'activa')`,
      [usuario_id, computador_id, tiempoMaximo]
    );

    const sessionId = result.insertId;

    // Regla 2: Actualizar estado del computador a 'ocupado'
    await run("UPDATE computadores SET estado = 'ocupado' WHERE id = ?", [computador_id]);

    // Si el usuario estaba en la lista de espera, marcar su turno como asignado y reordenar
    const waitingEntry = await getOne(
      "SELECT id FROM lista_espera WHERE usuario_id = ? AND estado = 'esperando'",
      [usuario_id]
    );
    if (waitingEntry) {
      await run("UPDATE lista_espera SET estado = 'asignado' WHERE id = ?", [waitingEntry.id]);
      await reorderQueue();
    }

    // Registrar auditoría
    await logAudit(
      req.user.id,
      'INICIO_SESION',
      `Inicio de sesión en ${pc.nombre} para usuario ID ${usuario_id} (Sesión #${sessionId}, Tiempo: ${tiempoMaximo} min)`
    );

    // Notificación al usuario
    await run(
      `INSERT INTO notificaciones (usuario_id, titulo, mensaje)
       VALUES (?, ?, ?)`,
      [
        usuario_id,
        `Sesión iniciada en ${pc.nombre}`,
        `Tu sesión ha comenzado exitosamente. Tienes un tiempo máximo de ${tiempoMaximo} minutos.`
      ]
    );

    // Emitir eventos en tiempo real
    const io = req.app.get('io');
    if (io) {
      io.emit('pc:updated', { action: 'session_started', pcId: computador_id, estado: 'ocupado' });
      io.emit('queue:updated');
      io.to(`user_${usuario_id}`).emit('session:started', { sessionId, pcId: computador_id });
    }

    return res.status(201).json({
      success: true,
      message: `Sesión iniciada en ${pc.nombre}.`,
      sessionId,
      tiempoMaximo
    });
  } catch (err) {
    console.error('Error en startSession:', err);
    return res.status(500).json({ success: false, message: 'Error al iniciar sesión de computador.' });
  }
}

/**
 * Obtener la sesión activa del usuario actual
 */
async function getMyActiveSession(req, res) {
  try {
    const userId = req.user.id;
    const session = await getOne(
      `SELECT s.id, s.fecha_inicio, s.tiempo_maximo, s.tiempo_utilizado, s.estado,
              c.id AS computador_id, c.nombre AS computador_nombre, c.numero AS computador_numero,
              c.ubicacion AS computador_ubicacion, c.descripcion AS computador_descripcion,
              u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento
       FROM sesiones s
       JOIN computadores c ON s.computador_id = c.id
       JOIN usuarios u ON s.usuario_id = u.id
       WHERE s.usuario_id = ? AND s.estado IN ('activa', 'proxima_finalizar')
       ORDER BY s.id DESC LIMIT 1`,
      [userId]
    );

    if (!session) {
      return res.json({
        success: true,
        hasActiveSession: false,
        session: null
      });
    }

    // Calcular temporizadores en vivo
    const now = new Date();
    const start = new Date(session.fecha_inicio);
    const segundosTranscurridos = Math.max(0, Math.floor((now - start) / 1000));
    const totalMaxSegundos = (session.tiempo_maximo || 60) * 60;
    const segundosRestantes = Math.max(0, totalMaxSegundos - segundosTranscurridos);
    const porcentajeUsado = Math.min(100, Math.floor((segundosTranscurridos / totalMaxSegundos) * 100));

    // Determinar nivel de advertencia
    let nivelAlerta = 'normal'; // 'normal' | 'advertencia' | 'critico' | 'expirado'
    if (segundosRestantes <= 0) {
      nivelAlerta = 'expirado';
    } else if (segundosRestantes <= 5 * 60) {
      nivelAlerta = 'critico';
    } else if (segundosRestantes <= 15 * 60) {
      nivelAlerta = 'advertencia';
    }

    return res.json({
      success: true,
      hasActiveSession: true,
      session: {
        ...session,
        segundosTranscurridos,
        segundosRestantes,
        porcentajeUsado,
        nivelAlerta,
        serverTime: now.toISOString()
      }
    });
  } catch (err) {
    console.error('Error en getMyActiveSession:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar sesión activa.' });
  }
}

/**
 * Obtener todas las sesiones activas (para Funcionario y Super Admin)
 */
async function getAllActiveSessions(req, res) {
  try {
    const sessions = await query(
      `SELECT s.id, s.fecha_inicio, s.tiempo_maximo, s.tiempo_utilizado, s.estado,
              c.id AS computador_id, c.nombre AS computador_nombre, c.numero AS computador_numero, c.ubicacion AS computador_ubicacion,
              u.id AS usuario_id, u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento, u.correo AS usuario_correo
       FROM sesiones s
       JOIN computadores c ON s.computador_id = c.id
       JOIN usuarios u ON s.usuario_id = u.id
       WHERE s.estado IN ('activa', 'proxima_finalizar')
       ORDER BY s.fecha_inicio ASC`
    );

    const now = new Date();
    const enriched = sessions.map(s => {
      const start = new Date(s.fecha_inicio);
      const segundosTranscurridos = Math.max(0, Math.floor((now - start) / 1000));
      const totalMaxSegundos = (s.tiempo_maximo || 60) * 60;
      const segundosRestantes = Math.max(0, totalMaxSegundos - segundosTranscurridos);
      const porcentajeUsado = Math.min(100, Math.floor((segundosTranscurridos / totalMaxSegundos) * 100));

      return {
        ...s,
        segundosTranscurridos,
        segundosRestantes,
        porcentajeUsado
      };
    });

    return res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Error en getAllActiveSessions:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar sesiones activas.' });
  }
}

/**
 * Finalizar una sesión (voluntaria por el usuario o forzada por funcionario/admin)
 */
async function endSession(req, res) {
  try {
    const { id } = req.params; // ID de la sesión
    const userId = req.user.id;
    const userRole = req.user.rol_nombre;

    const session = await getOne(
      `SELECT s.*, c.nombre AS pc_nombre, u.nombre_completo AS usuario_nombre
       FROM sesiones s
       JOIN computadores c ON s.computador_id = c.id
       JOIN usuarios u ON s.usuario_id = u.id
       WHERE s.id = ?`,
      [id]
    );

    if (!session) {
      return res.status(404).json({ success: false, message: 'Sesión no encontrada.' });
    }

    if (session.estado === 'finalizada' || session.estado === 'cancelada') {
      return res.status(400).json({ success: false, message: 'Esta sesión ya ha sido finalizada previamente.' });
    }

    // Un usuario solo puede finalizar su propia sesión; funcionario o admin pueden finalizar cualquiera
    if (userRole === 'usuario' && session.usuario_id !== userId) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para finalizar esta sesión.' });
    }

    const now = new Date();
    const start = new Date(session.fecha_inicio);
    const segundosUtilizados = Math.max(0, Math.floor((now - start) / 1000));

    // 1 y 2: Registrar fecha de finalización y tiempo total utilizado
    // 3: Guardar sesión en historial como 'finalizada'
    await run(
      `UPDATE sesiones
       SET fecha_fin = datetime('now', 'localtime'),
           tiempo_utilizado = ?,
           estado = 'finalizada'
       WHERE id = ?`,
      [segundosUtilizados, id]
    );

    // 4 y 5: Liberar automáticamente el computador y cambiar su estado a DISPONIBLE
    await run("UPDATE computadores SET estado = 'disponible' WHERE id = ?", [session.computador_id]);

    const minutosUtilizados = Math.round(segundosUtilizados / 60);

    // Auditoría
    const finalizador = userRole === 'usuario' ? 'el usuario voluntariamente' : `el personal (${req.user.nombre_completo})`;
    await logAudit(
      req.user.id,
      'FIN_SESION',
      `Sesión #${id} finalizada por ${finalizador} en ${session.pc_nombre}. Tiempo total: ${minutosUtilizados} min.`
    );

    // Notificación al usuario
    await run(
      `INSERT INTO notificaciones (usuario_id, titulo, mensaje)
       VALUES (?, ?, ?)`,
      [
        session.usuario_id,
        'Sesión finalizada',
        `Tu sesión en el equipo ${session.pc_nombre} ha finalizado. Tiempo utilizado: ${minutosUtilizados} minutos. ¡Gracias por usar la Biblioteca 12 de Octubre!`
      ]
    );

    // 6 y 7: Actualizar panel del funcionario y la lista de espera
    // Verificar si hay usuarios esperando para alertar
    const nextInQueue = await getOne(
      `SELECT l.id, l.usuario_id, u.nombre_completo
       FROM lista_espera l
       JOIN usuarios u ON l.usuario_id = u.id
       WHERE l.estado = 'esperando'
       ORDER BY l.posicion ASC LIMIT 1`
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('pc:updated', {
        action: 'session_ended',
        pcId: session.computador_id,
        estado: 'disponible',
        freedPC: session.pc_nombre
      });
      io.emit('queue:updated');
      io.to(`user_${session.usuario_id}`).emit('session:ended', { sessionId: id });

      if (nextInQueue) {
        io.emit('queue:pc_available', {
          pcId: session.computador_id,
          pcName: session.pc_nombre,
          nextUserId: nextInQueue.usuario_id,
          nextUserName: nextInQueue.nombre_completo
        });
      }
    }

    return res.json({
      success: true,
      message: `Sesión en ${session.pc_nombre} finalizada con éxito.`,
      tiempoUtilizadoMinutos: minutosUtilizados,
      hayColaEspera: !!nextInQueue,
      siguienteEnCola: nextInQueue ? nextInQueue.nombre_completo : null
    });
  } catch (err) {
    console.error('Error en endSession:', err);
    return res.status(500).json({ success: false, message: 'Error al finalizar sesión.' });
  }
}

/**
 * Extender tiempo de una sesión activa (Funcionario / Admin)
 */
async function extendSession(req, res) {
  try {
    const { id } = req.params;
    const { minutosAdicionales } = req.body;

    const mins = parseInt(minutosAdicionales || 15, 10);
    if (mins <= 0 || isNaN(mins)) {
      return res.status(400).json({ success: false, message: 'Indique una cantidad de minutos válida a agregar.' });
    }

    const session = await getOne(
      "SELECT s.*, c.nombre AS pc_nombre FROM sesiones s JOIN computadores c ON s.computador_id = c.id WHERE s.id = ? AND s.estado IN ('activa', 'proxima_finalizar')",
      [id]
    );

    if (!session) {
      return res.status(404).json({ success: false, message: 'Sesión activa no encontrada.' });
    }

    const nuevoMaximo = session.tiempo_maximo + mins;
    await run('UPDATE sesiones SET tiempo_maximo = ?, estado = "activa" WHERE id = ?', [nuevoMaximo, id]);

    await logAudit(
      req.user.id,
      'EXTENDER_TIEMPO_SESION',
      `Se extendió el tiempo de la sesión #${id} en ${mins} min (Nuevo total: ${nuevoMaximo} min)`
    );

    await run(
      'INSERT INTO notificaciones (usuario_id, titulo, mensaje) VALUES (?, ?, ?)',
      [
        session.usuario_id,
        'Tiempo extendido',
        `El personal ha extendido tu tiempo en ${mins} minutos adicionales. Nuevo límite: ${nuevoMaximo} minutos.`
      ]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${session.usuario_id}`).emit('session:extended', { nuevoMaximo, mins });
      io.emit('pc:updated', { action: 'session_extended', pcId: session.computador_id });
    }

    return res.json({
      success: true,
      message: `Tiempo extendido en ${mins} minutos. Total: ${nuevoMaximo} min.`,
      nuevoMaximo
    });
  } catch (err) {
    console.error('Error en extendSession:', err);
    return res.status(500).json({ success: false, message: 'Error al extender tiempo.' });
  }
}

/**
 * Historial de sesiones del usuario actual
 */
async function getMyHistory(req, res) {
  try {
    const userId = req.user.id;
    const history = await query(
      `SELECT s.id, s.fecha_inicio, s.fecha_fin, s.tiempo_maximo, s.tiempo_utilizado, s.estado,
              c.nombre AS computador_nombre, c.numero AS computador_numero, c.ubicacion AS computador_ubicacion
       FROM sesiones s
       JOIN computadores c ON s.computador_id = c.id
       WHERE s.usuario_id = ?
       ORDER BY s.fecha_inicio DESC`,
      [userId]
    );

    return res.json({
      success: true,
      data: history
    });
  } catch (err) {
    console.error('Error en getMyHistory:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar historial.' });
  }
}

/**
 * Historial general de todas las sesiones con filtros (Admin / Funcionario)
 */
async function getAllHistory(req, res) {
  try {
    const { fecha_inicio, fecha_fin, computador_id, usuario_id, estado } = req.query;

    let sql = `
      SELECT s.id, s.fecha_inicio, s.fecha_fin, s.tiempo_maximo, s.tiempo_utilizado, s.estado,
             c.id AS computador_id, c.nombre AS computador_nombre, c.numero AS computador_numero, c.ubicacion AS computador_ubicacion,
             u.id AS usuario_id, u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento, u.correo AS usuario_correo
      FROM sesiones s
      JOIN computadores c ON s.computador_id = c.id
      JOIN usuarios u ON s.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (computador_id) {
      sql += ' AND s.computador_id = ?';
      params.push(computador_id);
    }
    if (usuario_id) {
      sql += ' AND s.usuario_id = ?';
      params.push(usuario_id);
    }
    if (estado) {
      sql += ' AND s.estado = ?';
      params.push(estado);
    }
    if (fecha_inicio) {
      sql += ' AND date(s.fecha_inicio) >= date(?)';
      params.push(fecha_inicio);
    }
    if (fecha_fin) {
      sql += ' AND date(s.fecha_inicio) <= date(?)';
      params.push(fecha_fin);
    }

    sql += ' ORDER BY s.fecha_inicio DESC LIMIT 200';

    const history = await query(sql, params);

    return res.json({
      success: true,
      data: history
    });
  } catch (err) {
    console.error('Error en getAllHistory:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar historial general.' });
  }
}

/**
 * Reordena las posiciones de la lista de espera (1, 2, 3...)
 */
async function reorderQueue() {
  const waitingUsers = await query(
    "SELECT id FROM lista_espera WHERE estado = 'esperando' ORDER BY fecha_ingreso ASC"
  );
  for (let i = 0; i < waitingUsers.length; i++) {
    await run('UPDATE lista_espera SET posicion = ? WHERE id = ?', [i + 1, waitingUsers[i].id]);
  }
}

module.exports = {
  startSession,
  getMyActiveSession,
  getAllActiveSessions,
  endSession,
  extendSession,
  getMyHistory,
  getAllHistory,
  reorderQueue
};
