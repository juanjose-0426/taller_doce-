const { query, getOne, run } = require('../config/database');

/**
 * Obtener notificaciones del usuario autenticado
 */
async function getMyNotifications(req, res) {
  try {
    const userId = req.user.id;
    const notifications = await query(
      `SELECT id, titulo, mensaje, estado, fecha
       FROM notificaciones
       WHERE usuario_id = ?
       ORDER BY fecha DESC LIMIT 30`,
      [userId]
    );

    const unreadCount = await getOne(
      "SELECT COUNT(*) AS total FROM notificaciones WHERE usuario_id = ? AND estado = 'no_leida'",
      [userId]
    );

    return res.json({
      success: true,
      data: notifications,
      unreadCount: unreadCount ? unreadCount.total : 0
    });
  } catch (err) {
    console.error('Error en getMyNotifications:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar notificaciones.' });
  }
}

/**
 * Marcar una notificación como leída
 */
async function markAsRead(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await run(
      "UPDATE notificaciones SET estado = 'leida' WHERE id = ? AND usuario_id = ?",
      [id, userId]
    );

    return res.json({ success: true, message: 'Notificación marcada como leída.' });
  } catch (err) {
    console.error('Error en markAsRead:', err);
    return res.status(500).json({ success: false, message: 'Error al actualizar notificación.' });
  }
}

/**
 * Marcar todas las notificaciones como leídas
 */
async function markAllAsRead(req, res) {
  try {
    const userId = req.user.id;

    await run(
      "UPDATE notificaciones SET estado = 'leida' WHERE usuario_id = ?",
      [userId]
    );

    return res.json({ success: true, message: 'Todas las notificaciones han sido marcadas como leídas.' });
  } catch (err) {
    console.error('Error en markAllAsRead:', err);
    return res.status(500).json({ success: false, message: 'Error al actualizar notificaciones.' });
  }
}

module.exports = {
  getMyNotifications,
  markAsRead,
  markAllAsRead
};
