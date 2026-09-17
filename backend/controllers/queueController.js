const { query, getOne, run } = require('../config/database');
const { logAudit } = require('../utils/logger');
const { reorderQueue } = require('./sessionController');

/**
 * Obtener la lista de espera completa (para Funcionario y Super Admin)
 */
async function getQueue(req, res) {
  try {
    const queue = await query(
      `SELECT l.id, l.posicion, l.fecha_ingreso, l.estado,
              u.id AS usuario_id, u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento, u.correo AS usuario_correo
       FROM lista_espera l
       JOIN usuarios u ON l.usuario_id = u.id
       WHERE l.estado = 'esperando'
       ORDER BY l.posicion ASC`
    );

    const now = new Date();
    const enriched = queue.map(item => {
      const ingreso = new Date(item.fecha_ingreso);
      const minutosEspera = Math.max(0, Math.floor((now - ingreso) / 60000));
      return {
        ...item,
        minutosEspera
      };
    });

    return res.json({
      success: true,
      data: enriched,
      total: enriched.length
    });
  } catch (err) {
    console.error('Error en getQueue:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar la lista de espera.' });
  }
}

/**
 * Consultar posición y estado del usuario autenticado en la fila
 */
async function getMyPosition(req, res) {
  try {
    const userId = req.user.id;

    const entry = await getOne(
      `SELECT l.id, l.posicion, l.fecha_ingreso, l.estado
       FROM lista_espera l
       WHERE l.usuario_id = ? AND l.estado = 'esperando'
       ORDER BY l.id DESC LIMIT 1`,
      [userId]
    );

    if (!entry) {
      return res.json({
        success: true,
        inQueue: false,
        data: null
      });
    }

    const personasDelante = Math.max(0, entry.posicion - 1);
    const now = new Date();
    const ingreso = new Date(entry.fecha_ingreso);
    const minutosEspera = Math.max(0, Math.floor((now - ingreso) / 60000));

    return res.json({
      success: true,
      inQueue: true,
      data: {
        id: entry.id,
        posicion: entry.posicion,
        personasDelante,
        fecha_ingreso: entry.fecha_ingreso,
        minutosEspera,
        estado: entry.estado
      }
    });
  } catch (err) {
    console.error('Error en getMyPosition:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar posición en la fila.' });
  }
}

/**
 * Ingresar a la lista de espera digital
 */
async function joinQueue(req, res) {
  try {
    const userId = req.user.id;

    // Verificar si el usuario ya tiene sesión activa
    const activeSession = await getOne(
      "SELECT s.id, c.nombre FROM sesiones s JOIN computadores c ON s.computador_id = c.id WHERE s.usuario_id = ? AND s.estado IN ('activa', 'proxima_finalizar')",
      [userId]
    );
    if (activeSession) {
      return res.status(400).json({
        success: false,
        message: `Ya tienes una sesión activa en el equipo ${activeSession.nombre}. No puedes ingresar a la lista de espera.`
      });
    }

    // Verificar si ya está en la lista de espera
    const existingInQueue = await getOne(
      "SELECT id, posicion FROM lista_espera WHERE usuario_id = ? AND estado = 'esperando'",
      [userId]
    );
    if (existingInQueue) {
      return res.status(400).json({
        success: false,
        message: `Ya te encuentras registrado en la lista de espera con la posición #${existingInQueue.posicion}.`
      });
    }

    // Calcular posición siguiente
    const maxPos = await getOne(
      "SELECT COUNT(*) AS total FROM lista_espera WHERE estado = 'esperando'"
    );
    const nextPos = (maxPos ? maxPos.total : 0) + 1;

    const result = await run(
      `INSERT INTO lista_espera (usuario_id, posicion, fecha_ingreso, estado)
       VALUES (?, ?, datetime('now', 'localtime'), 'esperando')`,
      [userId, nextPos]
    );

    await logAudit(
      userId,
      'INGRESO_FILA',
      `El usuario ${req.user.nombre_completo} ingresó a la lista de espera (Posición #${nextPos})`
    );

    // Notificación
    await run(
      'INSERT INTO notificaciones (usuario_id, titulo, mensaje) VALUES (?, ?, ?)',
      [
        userId,
        'Registrado en lista de espera',
        `Estás en el turno #${nextPos}. Te avisaremos en cuanto un computador esté libre.`
      ]
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('queue:updated');
    }

    return res.status(201).json({
      success: true,
      message: `Has ingresado a la lista de espera con éxito. Tu posición actual es la #${nextPos}.`,
      posicion: nextPos,
      personasDelante: nextPos - 1
    });
  } catch (err) {
    console.error('Error en joinQueue:', err);
    return res.status(500).json({ success: false, message: 'Error al ingresar a la lista de espera.' });
  }
}

/**
 * Cancelar turno en la lista de espera
 */
async function leaveQueue(req, res) {
  try {
    const userId = req.user.id;
    const targetUserId = req.body.usuario_id || userId; // Funcionario puede retirar a un usuario ausente

    const entry = await getOne(
      "SELECT * FROM lista_espera WHERE usuario_id = ? AND estado = 'esperando'",
      [targetUserId]
    );

    if (!entry) {
      return res.status(404).json({ success: false, message: 'No se encontró registro activo en la lista de espera.' });
    }

    await run("UPDATE lista_espera SET estado = 'cancelado' WHERE id = ?", [entry.id]);

    // Reordenar posiciones de todos los que siguen
    await reorderQueue();

    const canceller = userId === targetUserId ? 'voluntariamente' : `por el personal (${req.user.nombre_completo})`;
    await logAudit(
      req.user.id,
      'SALIDA_FILA',
      `Turno #${entry.posicion} cancelado ${canceller} para usuario ID ${targetUserId}`
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('queue:updated');
      io.to(`user_${targetUserId}`).emit('queue:cancelled');
    }

    return res.json({
      success: true,
      message: 'Turno en la lista de espera cancelado correctamente.'
    });
  } catch (err) {
    console.error('Error en leaveQueue:', err);
    return res.status(500).json({ success: false, message: 'Error al cancelar turno.' });
  }
}

/**
 * Asignar el siguiente usuario de la fila a un computador disponible (Funcionario/Admin)
 */
async function assignNextUser(req, res) {
  try {
    const { computador_id } = req.body;

    if (!computador_id) {
      return res.status(400).json({ success: false, message: 'Debe seleccionar el computador a asignar.' });
    }

    // Verificar PC disponible
    const pc = await getOne('SELECT * FROM computadores WHERE id = ?', [computador_id]);
    if (!pc) {
      return res.status(404).json({ success: false, message: 'Computador no encontrado.' });
    }

    if (pc.estado !== 'disponible') {
      return res.status(400).json({
        success: false,
        message: `El computador ${pc.nombre} no está disponible (Estado: ${pc.estado}).`
      });
    }

    // Tomar al usuario en posición 1
    const nextInQueue = await getOne(
      `SELECT l.id AS turno_id, l.usuario_id, u.nombre_completo, u.documento
       FROM lista_espera l
       JOIN usuarios u ON l.usuario_id = u.id
       WHERE l.estado = 'esperando'
       ORDER BY l.posicion ASC LIMIT 1`
    );

    if (!nextInQueue) {
      return res.status(400).json({ success: false, message: 'No hay usuarios en la lista de espera en este momento.' });
    }

    // Obtener tiempo máximo configurado
    const config = await getOne('SELECT tiempo_maximo FROM configuracion WHERE id = 1');
    const tiempoMaximo = config ? config.tiempo_maximo : 60;

    // Iniciar sesión para el usuario
    const sessionRes = await run(
      `INSERT INTO sesiones (usuario_id, computador_id, fecha_inicio, tiempo_maximo, tiempo_utilizado, estado)
       VALUES (?, ?, datetime('now', 'localtime'), ?, 0, 'activa')`,
      [nextInQueue.usuario_id, computador_id, tiempoMaximo]
    );

    // Actualizar PC a ocupado
    await run("UPDATE computadores SET estado = 'ocupado' WHERE id = ?", [computador_id]);

    // Actualizar lista de espera
    await run("UPDATE lista_espera SET estado = 'asignado' WHERE id = ?", [nextInQueue.turno_id]);

    // Reordenar la cola restante
    await reorderQueue();

    await logAudit(
      req.user.id,
      'ASIGNACION_DESDE_FILA',
      `Se asignó el equipo ${pc.nombre} al usuario ${nextInQueue.nombre_completo} (Doc: ${nextInQueue.documento}) desde la lista de espera.`
    );

    // Notificación al usuario asignado
    await run(
      'INSERT INTO notificaciones (usuario_id, titulo, mensaje) VALUES (?, ?, ?)',
      [
        nextInQueue.usuario_id,
        '¡Tu computador está listo!',
        `Se te ha asignado el equipo ${pc.nombre} en ${pc.ubicacion}. Tu sesión ya ha iniciado con un tiempo de ${tiempoMaximo} minutos.`
      ]
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('pc:updated', { action: 'assigned_from_queue', pcId: computador_id, estado: 'ocupado' });
      io.emit('queue:updated');
      io.to(`user_${nextInQueue.usuario_id}`).emit('queue:assigned', {
        pcId: computador_id,
        pcNombre: pc.nombre,
        sessionId: sessionRes.insertId
      });
    }

    return res.json({
      success: true,
      message: `Computador ${pc.nombre} asignado con éxito a ${nextInQueue.nombre_completo}.`,
      usuario: nextInQueue.nombre_completo,
      computador: pc.nombre,
      sessionId: sessionRes.insertId
    });
  } catch (err) {
    console.error('Error en assignNextUser:', err);
    return res.status(500).json({ success: false, message: 'Error al asignar equipo desde la lista de espera.' });
  }
}

module.exports = {
  getQueue,
  getMyPosition,
  joinQueue,
  leaveQueue,
  assignNextUser
};
