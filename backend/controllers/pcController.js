const { query, getOne, run } = require('../config/database');
const { logAudit } = require('../utils/logger');

/**
 * Obtener todos los computadores con datos enriquecidos de sesión activa
 */
async function getAllPCs(req, res) {
  try {
    const pcs = await query(`
      SELECT
        c.id,
        c.nombre,
        c.numero,
        c.ubicacion,
        c.estado,
        c.descripcion,
        c.fecha_registro,
        s.id AS sesion_id,
        s.fecha_inicio AS sesion_fecha_inicio,
        s.tiempo_maximo AS sesion_tiempo_maximo,
        s.estado AS sesion_estado,
        u.id AS usuario_id,
        u.nombre_completo AS usuario_nombre,
        u.documento AS usuario_documento
      FROM computadores c
      LEFT JOIN sesiones s ON c.id = s.computador_id AND s.estado IN ('activa', 'proxima_finalizar')
      LEFT JOIN usuarios u ON s.usuario_id = u.id
      ORDER BY c.numero ASC
    `);

    // Calcular segundos transcurridos y restantes en base a la hora actual
    const now = new Date();
    const enrichedPCs = pcs.map(pc => {
      let segundos_transcurridos = 0;
      let segundos_restantes = 0;
      let porcentaje_usado = 0;

      if (pc.sesion_id && pc.sesion_fecha_inicio) {
        const start = new Date(pc.sesion_fecha_inicio);
        segundos_transcurridos = Math.max(0, Math.floor((now - start) / 1000));
        const totalMaxSegundos = (pc.sesion_tiempo_maximo || 60) * 60;
        segundos_restantes = Math.max(0, totalMaxSegundos - segundos_transcurridos);
        porcentaje_usado = Math.min(100, Math.floor((segundos_transcurridos / totalMaxSegundos) * 100));
      }

      return {
        id: pc.id,
        nombre: pc.nombre,
        numero: pc.numero,
        ubicacion: pc.ubicacion,
        estado: pc.estado,
        descripcion: pc.descripcion,
        especificaciones: pc.descripcion,
        fecha_registro: pc.fecha_registro,
        sesion_activa: pc.sesion_id ? {
          id: pc.sesion_id,
          fecha_inicio: pc.sesion_fecha_inicio,
          tiempo_maximo: pc.sesion_tiempo_maximo,
          estado: pc.sesion_estado,
          usuario_id: pc.usuario_id,
          usuario_nombre: pc.usuario_nombre,
          usuario_documento: pc.usuario_documento,
          segundosTranscurridos: segundos_transcurridos,
          segundosRestantes: segundos_restantes,
          porcentajeUsado: porcentaje_usado
        } : null,
        segundos_transcurridos,
        segundos_restantes,
        porcentaje_usado
      };
    });

    return res.json({
      success: true,
      data: enrichedPCs
    });
  } catch (err) {
    console.error('Error en getAllPCs:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar computadores.' });
  }
}

/**
 * Obtener solo computadores disponibles
 */
async function getAvailablePCs(req, res) {
  try {
    const pcs = await query(
      `SELECT id, nombre, numero, ubicacion, estado, descripcion
       FROM computadores
       WHERE estado = 'disponible'
       ORDER BY numero ASC`
    );

    return res.json({
      success: true,
      data: pcs
    });
  } catch (err) {
    console.error('Error en getAvailablePCs:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar computadores disponibles.' });
  }
}

/**
 * Obtener un computador por ID
 */
async function getPCById(req, res) {
  try {
    const { id } = req.params;
    const pc = await getOne(
      `SELECT c.*,
              s.id AS sesion_activa_id, s.fecha_inicio AS sesion_fecha_inicio, s.tiempo_maximo AS sesion_tiempo_maximo,
              u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento
       FROM computadores c
       LEFT JOIN sesiones s ON c.id = s.computador_id AND s.estado IN ('activa', 'proxima_finalizar')
       LEFT JOIN usuarios u ON s.usuario_id = u.id
       WHERE c.id = ?`,
      [id]
    );

    if (!pc) {
      return res.status(404).json({ success: false, message: 'Computador no encontrado.' });
    }

    return res.json({ success: true, data: pc });
  } catch (err) {
    console.error('Error en getPCById:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar computador.' });
  }
}

/**
 * Crear un nuevo computador (Admin)
 */
async function createPC(req, res) {
  try {
    const { nombre, numero, ubicacion, descripcion } = req.body;

    if (!nombre || !numero || !ubicacion) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, número y ubicación son requeridos.'
      });
    }

    const exists = await getOne('SELECT id FROM computadores WHERE numero = ?', [numero]);
    if (exists) {
      return res.status(409).json({
        success: false,
        message: `Ya existe un computador con el número ${numero}.`
      });
    }

    const result = await run(
      'INSERT INTO computadores (nombre, numero, ubicacion, estado, descripcion) VALUES (?, ?, ?, ?, ?)',
      [nombre.trim(), parseInt(numero, 10), ubicacion.trim(), 'disponible', descripcion ? descripcion.trim() : null]
    );

    await logAudit(
      req.user.id,
      'CREAR_COMPUTADOR',
      `Creación de computador ${nombre} (Nº ${numero}) en ${ubicacion}`
    );

    // Emitir evento Socket si está disponible en app
    const io = req.app.get('io');
    if (io) io.emit('pc:updated', { action: 'created', pcId: result.insertId });

    return res.status(201).json({
      success: true,
      message: `Computador ${nombre} registrado exitosamente.`,
      pcId: result.insertId
    });
  } catch (err) {
    console.error('Error en createPC:', err);
    return res.status(500).json({ success: false, message: 'Error al registrar computador.' });
  }
}

/**
 * Editar un computador (Admin)
 */
async function updatePC(req, res) {
  try {
    const { id } = req.params;
    const { nombre, numero, ubicacion, descripcion, estado } = req.body;

    const pc = await getOne('SELECT * FROM computadores WHERE id = ?', [id]);
    if (!pc) {
      return res.status(404).json({ success: false, message: 'Computador no encontrado.' });
    }

    // Verificar número si cambió
    if (numero && parseInt(numero, 10) !== pc.numero) {
      const numExists = await getOne('SELECT id FROM computadores WHERE numero = ? AND id != ?', [numero, id]);
      if (numExists) {
        return res.status(409).json({ success: false, message: `El número ${numero} ya está en uso por otro equipo.` });
      }
    }

    const newName = nombre ? nombre.trim() : pc.nombre;
    const newNum = numero ? parseInt(numero, 10) : pc.numero;
    const newLoc = ubicacion ? ubicacion.trim() : pc.ubicacion;
    const newDesc = descripcion !== undefined ? descripcion.trim() : pc.descripcion;
    const newStatus = estado || pc.estado;

    await run(
      'UPDATE computadores SET nombre = ?, numero = ?, ubicacion = ?, descripcion = ?, estado = ? WHERE id = ?',
      [newName, newNum, newLoc, newDesc, newStatus, id]
    );

    await logAudit(
      req.user.id,
      'EDITAR_COMPUTADOR',
      `Edición de computador ${newName} (ID: ${id})`
    );

    const io = req.app.get('io');
    if (io) io.emit('pc:updated', { action: 'updated', pcId: id });

    return res.json({
      success: true,
      message: `Computador ${newName} actualizado exitosamente.`
    });
  } catch (err) {
    console.error('Error en updatePC:', err);
    return res.status(500).json({ success: false, message: 'Error al actualizar computador.' });
  }
}

/**
 * Eliminar computador (Admin)
 */
async function deletePC(req, res) {
  try {
    const { id } = req.params;

    const pc = await getOne('SELECT * FROM computadores WHERE id = ?', [id]);
    if (!pc) {
      return res.status(404).json({ success: false, message: 'Computador no encontrado.' });
    }

    // Verificar si tiene sesión activa
    const activeSession = await getOne(
      "SELECT id FROM sesiones WHERE computador_id = ? AND estado IN ('activa', 'proxima_finalizar')",
      [id]
    );
    if (activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No se puede eliminar un equipo con una sesión activa en curso. Finalice la sesión primero.'
      });
    }

    await run('DELETE FROM computadores WHERE id = ?', [id]);

    await logAudit(
      req.user.id,
      'ELIMINAR_COMPUTADOR',
      `Eliminación del computador ${pc.nombre} (Nº ${pc.numero})`
    );

    const io = req.app.get('io');
    if (io) io.emit('pc:updated', { action: 'deleted', pcId: id });

    return res.json({
      success: true,
      message: `Computador ${pc.nombre} eliminado.`
    });
  } catch (err) {
    console.error('Error en deletePC:', err);
    return res.status(500).json({ success: false, message: 'Error al eliminar computador.' });
  }
}

/**
 * Cambiar estado de un computador (Disponible, Fuera de servicio, etc.) (Funcionario/Admin)
 */
async function changeStatus(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const validStatuses = ['disponible', 'ocupado', 'proximo_terminar', 'reservado', 'fuera_servicio'];
    if (!validStatuses.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: `Estado inválido. Debe ser uno de: ${validStatuses.join(', ')}`
      });
    }

    const pc = await getOne('SELECT * FROM computadores WHERE id = ?', [id]);
    if (!pc) {
      return res.status(404).json({ success: false, message: 'Computador no encontrado.' });
    }

    // Si se pasa a fuera de servicio y tenía sesión activa, advertir o cancelar
    if (estado === 'fuera_servicio') {
      const activeSession = await getOne(
        "SELECT id FROM sesiones WHERE computador_id = ? AND estado IN ('activa', 'proxima_finalizar')",
        [id]
      );
      if (activeSession) {
        // Finalizar forzosamente la sesión
        await run(
          "UPDATE sesiones SET estado = 'cancelada', fecha_fin = datetime('now', 'localtime') WHERE id = ?",
          [activeSession.id]
        );
      }
    }

    await run('UPDATE computadores SET estado = ? WHERE id = ?', [estado, id]);

    await logAudit(
      req.user.id,
      'CAMBIO_ESTADO_PC',
      `Cambio de estado para ${pc.nombre}: ${pc.estado} ➔ ${estado}`
    );

    const io = req.app.get('io');
    if (io) io.emit('pc:updated', { action: 'status_changed', pcId: id, estado });

    return res.json({
      success: true,
      message: `Estado del computador ${pc.nombre} cambiado a ${estado}.`
    });
  } catch (err) {
    console.error('Error en changeStatus:', err);
    return res.status(500).json({ success: false, message: 'Error al cambiar estado del computador.' });
  }
}

/**
 * Historial de sesiones de un computador específico
 */
async function getPCHistory(req, res) {
  try {
    const { id } = req.params;
    const history = await query(
      `SELECT s.id, s.fecha_inicio, s.fecha_fin, s.tiempo_maximo, s.tiempo_utilizado, s.estado,
              u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento
       FROM sesiones s
       JOIN usuarios u ON s.usuario_id = u.id
       WHERE s.computador_id = ?
       ORDER BY s.fecha_inicio DESC
       LIMIT 50`,
      [id]
    );

    return res.json({
      success: true,
      data: history
    });
  } catch (err) {
    console.error('Error en getPCHistory:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar historial del computador.' });
  }
}

module.exports = {
  getAllPCs,
  getAvailablePCs,
  getPCById,
  createPC,
  updatePC,
  deletePC,
  changeStatus,
  getPCHistory
};
