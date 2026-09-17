const { run } = require('../config/database');

/**
 * Registra una acción en la tabla historial_acciones (Auditoría)
 * @param {number|null} usuarioId ID del usuario responsable
 * @param {string} accion Identificador de la acción (ej: LOGIN, INICIO_SESION, CAMBIO_ESTADO_PC)
 * @param {string} descripcion Detalle explicativo de la acción realizada
 */
async function logAudit(usuarioId, accion, descripcion) {
  try {
    await run(
      'INSERT INTO historial_acciones (usuario_id, accion, descripcion) VALUES (?, ?, ?)',
      [usuarioId || null, accion, descripcion]
    );
  } catch (err) {
    console.error('⚠️ [AUDIT] Error al registrar historial de auditoría:', err.message);
  }
}

module.exports = {
  logAudit
};
