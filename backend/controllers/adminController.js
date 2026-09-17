const bcrypt = require('bcryptjs');
const { query, getOne, run } = require('../config/database');
const { logAudit } = require('../utils/logger');

/**
 * Indicadores generales para el Dashboard del Super Admin
 */
async function getDashboardKPIs(req, res) {
  try {
    const totalPcs = await getOne('SELECT COUNT(*) AS total FROM computadores');
    const pcsDisponibles = await getOne("SELECT COUNT(*) AS total FROM computadores WHERE estado = 'disponible'");
    const pcsOcupados = await getOne("SELECT COUNT(*) AS total FROM computadores WHERE estado = 'ocupado'");
    const pcsMantenimiento = await getOne("SELECT COUNT(*) AS total FROM computadores WHERE estado = 'fuera_servicio'");

    const totalUsuarios = await getOne('SELECT COUNT(*) AS total FROM usuarios WHERE rol_id = 3');
    const totalFuncionarios = await getOne('SELECT COUNT(*) AS total FROM usuarios WHERE rol_id = 2');
    const sesionesActivas = await getOne("SELECT COUNT(*) AS total FROM sesiones WHERE estado IN ('activa', 'proxima_finalizar')");
    const enCola = await getOne("SELECT COUNT(*) AS total FROM lista_espera WHERE estado = 'esperando'");
    const totalSesiones = await getOne('SELECT COUNT(*) AS total FROM sesiones');

    // Tiempo promedio de uso en minutos
    const avgTime = await getOne('SELECT AVG(tiempo_utilizado) AS avg_sec FROM sesiones WHERE tiempo_utilizado > 0');
    const tiempoPromedioMinutos = avgTime && avgTime.avg_sec ? Math.round(avgTime.avg_sec / 60) : 0;

    return res.json({
      success: true,
      data: {
        totalComputadores: totalPcs.total,
        computadoresDisponibles: pcsDisponibles.total,
        computadoresOcupados: pcsOcupados.total,
        computadoresMantenimiento: pcsMantenimiento.total,
        totalUsuarios: totalUsuarios.total,
        totalFuncionarios: totalFuncionarios.total,
        sesionesActivas: sesionesActivas.total,
        enColaEspera: enCola.total,
        totalSesionesHistoricas: totalSesiones.total,
        tiempoPromedioMinutos
      }
    });
  } catch (err) {
    console.error('Error en getDashboardKPIs:', err);
    return res.status(500).json({ success: false, message: 'Error al obtener indicadores del dashboard.' });
  }
}

/**
 * Estadísticas avanzadas con datos para gráficos (Chart.js)
 */
async function getStatistics(req, res) {
  try {
    // 1. Computadores más y menos utilizados
    const pcUsage = await query(`
      SELECT c.nombre, c.numero, c.ubicacion,
             COUNT(s.id) AS total_sesiones,
             COALESCE(SUM(s.tiempo_utilizado), 0) AS total_segundos
      FROM computadores c
      LEFT JOIN sesiones s ON c.id = s.computador_id
      GROUP BY c.id
      ORDER BY total_sesiones DESC, total_segundos DESC
    `);

    const masUtilizados = pcUsage.slice(0, 5);
    const menosUtilizados = [...pcUsage].reverse().slice(0, 5);

    // 2. Horarios de mayor demanda (distribución por hora del día)
    // En SQLite strftime('%H', fecha_inicio) o MySQL HOUR(fecha_inicio)
    const horasData = await query(`
      SELECT CAST(strftime('%H', fecha_inicio) AS INTEGER) AS hora, COUNT(*) AS cantidad
      FROM sesiones
      WHERE fecha_inicio IS NOT NULL
      GROUP BY hora
      ORDER BY hora ASC
    `);

    // Crear mapa de 08:00 a 19:00
    const horasMap = {};
    for (let h = 8; h <= 19; h++) horasMap[h] = 0;
    horasData.forEach(item => {
      if (item.hora !== null && item.hora !== undefined) {
        horasMap[item.hora] = item.cantidad;
      }
    });

    const horasLabels = Object.keys(horasMap).map(h => `${h.padStart(2, '0')}:00`);
    const horasValues = Object.values(horasMap);

    // 3. Uso en los últimos 7 días
    const dailyData = await query(`
      SELECT date(fecha_inicio) AS dia, COUNT(*) AS total
      FROM sesiones
      WHERE date(fecha_inicio) >= date('now', 'localtime', '-7 days')
      GROUP BY dia
      ORDER BY dia ASC
    `);

    // 4. Cantidad total de usuarios únicos atendidos
    const usuariosAtendidos = await getOne(
      'SELECT COUNT(DISTINCT usuario_id) AS total FROM sesiones'
    );

    // 5. Tiempo promedio de uso
    const avgTimeRes = await getOne(
      'SELECT AVG(tiempo_utilizado) AS promedio FROM sesiones WHERE estado = "finalizada"'
    );
    const promedioMinutos = avgTimeRes && avgTimeRes.promedio ? Math.round(avgTimeRes.promedio / 60) : 45;

    return res.json({
      success: true,
      data: {
        masUtilizados,
        menosUtilizados,
        horariosDemanda: {
          labels: horasLabels,
          values: horasValues
        },
        usoSemanal: dailyData,
        usuariosAtendidos: usuariosAtendidos ? usuariosAtendidos.total : 0,
        promedioMinutos
      }
    });
  } catch (err) {
    console.error('Error en getStatistics:', err);
    return res.status(500).json({ success: false, message: 'Error al generar estadísticas.' });
  }
}

/**
 * Gestión de usuarios (CRUD)
 */
async function getUsers(req, res) {
  try {
    const { busqueda, rol_id, estado } = req.query;

    let sql = `
      SELECT u.id, u.nombre_completo, u.documento, u.correo, u.rol_id, u.estado, u.fecha_registro,
             r.nombre AS rol_nombre,
             (SELECT COUNT(*) FROM sesiones WHERE usuario_id = u.id) AS total_sesiones
      FROM usuarios u
      JOIN roles r ON u.rol_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (busqueda) {
      sql += ' AND (u.nombre_completo LIKE ? OR u.documento LIKE ? OR u.correo LIKE ?)';
      const term = `%${busqueda.trim()}%`;
      params.push(term, term, term);
    }

    if (rol_id) {
      sql += ' AND u.rol_id = ?';
      params.push(rol_id);
    }

    if (estado) {
      sql += ' AND u.estado = ?';
      params.push(estado);
    }

    sql += ' ORDER BY u.fecha_registro DESC';

    const users = await query(sql, params);

    return res.json({ success: true, data: users });
  } catch (err) {
    console.error('Error en getUsers:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar usuarios.' });
  }
}

/**
 * Crear usuario por parte del Administrador
 */
async function createUser(req, res) {
  try {
    const { nombre_completo, documento, correo, password, rol_id } = req.body;

    if (!nombre_completo || !documento || !correo || !password || !rol_id) {
      return res.status(400).json({ success: false, message: 'Todos los campos son requeridos.' });
    }

    const docExists = await getOne('SELECT id FROM usuarios WHERE documento = ?', [documento.trim()]);
    if (docExists) {
      return res.status(409).json({ success: false, message: 'Ya existe un usuario con este documento.' });
    }

    const emailExists = await getOne('SELECT id FROM usuarios WHERE correo = ?', [correo.trim().toLowerCase()]);
    if (emailExists) {
      return res.status(409).json({ success: false, message: 'Ya existe un usuario con este correo.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO usuarios (nombre_completo, documento, correo, password, rol_id, estado) VALUES (?, ?, ?, ?, ?, "activo")',
      [nombre_completo.trim(), documento.trim(), correo.trim().toLowerCase(), passwordHash, parseInt(rol_id, 10)]
    );

    await logAudit(
      req.user.id,
      'CREAR_USUARIO_ADMIN',
      `Administrador creó al usuario ${nombre_completo} (Doc: ${documento}, Rol: ${rol_id})`
    );

    return res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente.',
      userId: result.insertId
    });
  } catch (err) {
    console.error('Error en createUser:', err);
    return res.status(500).json({ success: false, message: 'Error al crear usuario.' });
  }
}

/**
 * Actualizar usuario (Admin)
 */
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { nombre_completo, documento, correo, rol_id, estado, nueva_password } = req.body;

    const user = await getOne('SELECT * FROM usuarios WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    if (documento && documento.trim() !== user.documento) {
      const docExists = await getOne('SELECT id FROM usuarios WHERE documento = ? AND id != ?', [documento.trim(), id]);
      if (docExists) {
        return res.status(409).json({ success: false, message: 'El documento ya está en uso por otro usuario.' });
      }
    }

    if (correo && correo.trim().toLowerCase() !== user.correo) {
      const mailExists = await getOne('SELECT id FROM usuarios WHERE correo = ? AND id != ?', [correo.trim().toLowerCase(), id]);
      if (mailExists) {
        return res.status(409).json({ success: false, message: 'El correo ya está en uso por otro usuario.' });
      }
    }

    let passwordHash = user.password;
    if (nueva_password && nueva_password.trim().length >= 6) {
      passwordHash = await bcrypt.hash(nueva_password.trim(), 10);
    }

    const updatedName = nombre_completo ? nombre_completo.trim() : user.nombre_completo;
    const updatedDoc = documento ? documento.trim() : user.documento;
    const updatedEmail = correo ? correo.trim().toLowerCase() : user.correo;
    const updatedRole = rol_id ? parseInt(rol_id, 10) : user.rol_id;
    const updatedStatus = estado || user.estado;

    await run(
      'UPDATE usuarios SET nombre_completo = ?, documento = ?, correo = ?, password = ?, rol_id = ?, estado = ? WHERE id = ?',
      [updatedName, updatedDoc, updatedEmail, passwordHash, updatedRole, updatedStatus, id]
    );

    await logAudit(
      req.user.id,
      'EDITAR_USUARIO_ADMIN',
      `Edición del usuario ${updatedName} (ID: ${id})`
    );

    return res.json({
      success: true,
      message: `Usuario ${updatedName} actualizado exitosamente.`
    });
  } catch (err) {
    console.error('Error en updateUser:', err);
    return res.status(500).json({ success: false, message: 'Error al actualizar usuario.' });
  }
}

/**
 * Activar o desactivar usuario (Admin)
 */
async function toggleUserStatus(req, res) {
  try {
    const { id } = req.params;

    const user = await getOne('SELECT * FROM usuarios WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'No puedes desactivar tu propia cuenta administradora.' });
    }

    const newStatus = user.estado === 'activo' ? 'inactivo' : 'activo';
    await run('UPDATE usuarios SET estado = ? WHERE id = ?', [newStatus, id]);

    await logAudit(
      req.user.id,
      'CAMBIAR_ESTADO_USUARIO',
      `Estado del usuario ${user.nombre_completo} cambiado a: ${newStatus}`
    );

    return res.json({
      success: true,
      message: `Usuario ${newStatus === 'activo' ? 'activado' : 'desactivado'} correctamente.`,
      nuevoEstado: newStatus
    });
  } catch (err) {
    console.error('Error en toggleUserStatus:', err);
    return res.status(500).json({ success: false, message: 'Error al cambiar estado del usuario.' });
  }
}

/**
 * Obtener lista de roles disponibles
 */
async function getRoles(req, res) {
  try {
    const roles = await query('SELECT * FROM roles ORDER BY id ASC');
    return res.json({ success: true, data: roles });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error al consultar roles.' });
  }
}

/**
 * Obtener configuración general del sistema
 */
async function getConfig(req, res) {
  try {
    const config = await getOne('SELECT * FROM configuracion WHERE id = 1');
    return res.json({
      success: true,
      data: config || {
        tiempo_maximo: 60,
        tiempo_alerta: 15,
        reglas_lista_espera: 'Orden de llegada estricto (FIFO).',
        accion_fin_tiempo: 'finalizar_automatica'
      }
    });
  } catch (err) {
    console.error('Error en getConfig:', err);
    return res.status(500).json({ success: false, message: 'Error al obtener configuración.' });
  }
}

/**
 * Actualizar configuración del sistema (Admin)
 */
async function updateConfig(req, res) {
  try {
    const { tiempo_maximo, tiempo_alerta, reglas_lista_espera, accion_fin_tiempo } = req.body;

    const maxTime = parseInt(tiempo_maximo, 10) || 60;
    const alertTime = parseInt(tiempo_alerta, 10) || 15;
    const rules = reglas_lista_espera ? reglas_lista_espera.trim() : '';
    const action = accion_fin_tiempo || 'finalizar_automatica';

    await run(
      `UPDATE configuracion
       SET tiempo_maximo = ?, tiempo_alerta = ?, reglas_lista_espera = ?, accion_fin_tiempo = ?
       WHERE id = 1`,
      [maxTime, alertTime, rules, action]
    );

    await logAudit(
      req.user.id,
      'ACTUALIZAR_CONFIGURACION',
      `Configuración modificada: Max ${maxTime} min, Alerta ${alertTime} min, Acción: ${action}`
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('config:updated', { tiempo_maximo: maxTime, tiempo_alerta: alertTime });
    }

    return res.json({
      success: true,
      message: 'Configuración general del sistema actualizada con éxito.'
    });
  } catch (err) {
    console.error('Error en updateConfig:', err);
    return res.status(500).json({ success: false, message: 'Error al actualizar configuración.' });
  }
}

/**
 * Obtener registro de auditoría (historial_acciones)
 */
async function getAuditLogs(req, res) {
  try {
    const { accion, usuario_id, limit } = req.query;
    let sql = `
      SELECT h.id, h.usuario_id, h.accion, h.descripcion, h.fecha,
             u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento, r.nombre AS rol_nombre
      FROM historial_acciones h
      LEFT JOIN usuarios u ON h.usuario_id = u.id
      LEFT JOIN roles r ON u.rol_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (accion) {
      sql += ' AND h.accion LIKE ?';
      params.push(`%${accion.trim()}%`);
    }

    if (usuario_id) {
      sql += ' AND h.usuario_id = ?';
      params.push(usuario_id);
    }

    sql += ' ORDER BY h.fecha DESC LIMIT ?';
    params.push(parseInt(limit || 100, 10));

    const logs = await query(sql, params);

    return res.json({
      success: true,
      data: logs
    });
  } catch (err) {
    console.error('Error en getAuditLogs:', err);
    return res.status(500).json({ success: false, message: 'Error al consultar logs de auditoría.' });
  }
}

/**
 * Generador de reportes consolidados con métricas
 */
async function getReports(req, res) {
  try {
    const { fecha_inicio, fecha_fin, computador_id, usuario_id } = req.query;

    let sql = `
      SELECT s.id, s.fecha_inicio, s.fecha_fin, s.tiempo_maximo, s.tiempo_utilizado, s.estado,
             c.nombre AS pc_nombre, c.numero AS pc_numero, c.ubicacion AS pc_ubicacion,
             u.nombre_completo AS usuario_nombre, u.documento AS usuario_documento
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
    if (fecha_inicio) {
      sql += ' AND date(s.fecha_inicio) >= date(?)';
      params.push(fecha_inicio);
    }
    if (fecha_fin) {
      sql += ' AND date(s.fecha_inicio) <= date(?)';
      params.push(fecha_fin);
    }

    sql += ' ORDER BY s.fecha_inicio DESC';

    const rows = await query(sql, params);

    // Calcular métricas del reporte
    const totalSesiones = rows.length;
    let totalSegundos = 0;
    rows.forEach(r => { totalSegundos += (r.tiempo_utilizado || 0); });
    const promedioMinutos = totalSesiones > 0 ? Math.round((totalSegundos / totalSesiones) / 60) : 0;
    const totalHoras = (totalSegundos / 3600).toFixed(1);

    return res.json({
      success: true,
      resumen: {
        totalSesiones,
        promedioMinutos,
        totalHoras
      },
      data: rows
    });
  } catch (err) {
    console.error('Error en getReports:', err);
    return res.status(500).json({ success: false, message: 'Error al generar reporte.' });
  }
}

module.exports = {
  getDashboardKPIs,
  getStatistics,
  getUsers,
  createUser,
  updateUser,
  toggleUserStatus,
  getRoles,
  getConfig,
  updateConfig,
  getAuditLogs,
  getReports
};
