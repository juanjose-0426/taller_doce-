const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, getOne, run } = require('../config/database');
const { JWT_SECRET } = require('../middlewares/auth');
const { logAudit } = require('../utils/logger');

/**
 * Registro de un nuevo usuario (rol lector/visitante por defecto)
 */
async function register(req, res) {
  try {
    const { nombre_completo, documento, correo, password } = req.body;

    if (!nombre_completo || !documento || !correo || !password) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son obligatorios (Nombre, Documento, Correo y Contraseña).'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres.'
      });
    }

    // Verificar si ya existe documento o correo
    const existingDoc = await getOne('SELECT id FROM usuarios WHERE documento = ?', [documento.trim()]);
    if (existingDoc) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un usuario registrado con este número de documento.'
      });
    }

    const existingEmail = await getOne('SELECT id FROM usuarios WHERE correo = ?', [correo.trim().toLowerCase()]);
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un usuario registrado con este correo electrónico.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO usuarios (nombre_completo, documento, correo, password, rol_id, estado)
       VALUES (?, ?, ?, ?, 3, 'activo')`,
      [nombre_completo.trim(), documento.trim(), correo.trim().toLowerCase(), passwordHash]
    );

    await logAudit(
      result.insertId,
      'REGISTRO_USUARIO',
      `Nuevo usuario registrado: ${nombre_completo} (Doc: ${documento})`
    );

    // Generar token JWT automático tras registro
    const token = jwt.sign(
      { id: result.insertId, rol_id: 3, rol_nombre: 'usuario' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente en la Biblioteca 12 de Octubre.',
      token,
      user: {
        id: result.insertId,
        nombre_completo: nombre_completo.trim(),
        documento: documento.trim(),
        correo: correo.trim().toLowerCase(),
        rol_id: 3,
        rol_nombre: 'usuario',
        rol: 'usuario',
        estado: 'activo'
      }
    });
  } catch (err) {
    console.error('Error en register:', err);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor al procesar el registro.'
    });
  }
}

/**
 * Inicio de sesión con documento o correo electrónico
 */
async function login(req, res) {
  try {
    const { identificador, documento, correo, password, portal } = req.body;
    const credencial = (identificador || documento || correo || '').trim();

    if (!credencial || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor ingrese su documento o correo y su contraseña.'
      });
    }

    const user = await getOne(
      `SELECT u.id, u.nombre_completo, u.documento, u.correo, u.password, u.rol_id, u.estado, r.nombre AS rol_nombre
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.documento = ? OR LOWER(u.correo) = LOWER(?)`,
      [credencial, credencial]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas. Verifique su documento o correo y contraseña.'
      });
    }

    if (user.estado !== 'activo') {
      return res.status(403).json({
        success: false,
        message: 'Esta cuenta ha sido desactivada. Comuníquese con el personal de la biblioteca.'
      });
    }

    // Validación de portal de ingreso separado
    if (portal === 'superadmin') {
      if (user.rol_nombre !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: '⛔ Acceso denegado: Este portal es exclusivo para Super Administradores. Tu cuenta no cuenta con permisos administrativos de nivel maestro.'
        });
      }
    } else if (portal === 'funcionario') {
      if (user.rol_nombre !== 'funcionario' && user.rol_nombre !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: '⛔ Acceso denegado: Este portal es exclusivo para el Personal / Funcionarios de la Biblioteca 12 de Octubre.'
        });
      }
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña incorrecta. Inténtelo nuevamente.'
      });
    }

    const token = jwt.sign(
      { id: user.id, rol_id: user.rol_id, rol_nombre: user.rol_nombre },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAudit(
      user.id,
      'INICIO_SESION_PLATAFORMA',
      `Inicio de sesión exitoso de ${user.nombre_completo} con rol ${user.rol_nombre}`
    );

    return res.json({
      success: true,
      message: `¡Bienvenido(a), ${user.nombre_completo}!`,
      token,
      user: {
        id: user.id,
        nombre_completo: user.nombre_completo,
        documento: user.documento,
        correo: user.correo,
        rol_id: user.rol_id,
        rol_nombre: user.rol_nombre,
        rol: user.rol_nombre,
        estado: user.estado
      }
    });
  } catch (err) {
    console.error('Error en login:', err);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor al iniciar sesión.'
    });
  }
}

/**
 * Obtener perfil del usuario autenticado
 */
async function getProfile(req, res) {
  try {
    return res.json({
      success: true,
      user: req.user
    });
  } catch (err) {
    console.error('Error en getProfile:', err);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener datos del perfil.'
    });
  }
}

/**
 * Actualizar datos personales y/o contraseña
 */
async function updateProfile(req, res) {
  try {
    const { nombre_completo, correo, password_actual, nueva_password } = req.body;
    const userId = req.user.id;

    const currentUser = await getOne('SELECT * FROM usuarios WHERE id = ?', [userId]);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    // Si intenta cambiar contraseña
    let updatedPasswordHash = currentUser.password;
    if (nueva_password) {
      if (!password_actual) {
        return res.status(400).json({
          success: false,
          message: 'Debe ingresar su contraseña actual para establecer una nueva.'
        });
      }
      const match = await bcrypt.compare(password_actual, currentUser.password);
      if (!match) {
        return res.status(400).json({
          success: false,
          message: 'La contraseña actual no es correcta.'
        });
      }
      if (nueva_password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'La nueva contraseña debe tener al menos 6 caracteres.'
        });
      }
      updatedPasswordHash = await bcrypt.hash(nueva_password, 10);
    }

    const updatedName = nombre_completo ? nombre_completo.trim() : currentUser.nombre_completo;
    const updatedEmail = correo ? correo.trim().toLowerCase() : currentUser.correo;

    // Verificar unicidad de correo si cambió
    if (updatedEmail !== currentUser.correo) {
      const emailExists = await getOne('SELECT id FROM usuarios WHERE correo = ? AND id != ?', [updatedEmail, userId]);
      if (emailExists) {
        return res.status(409).json({ success: false, message: 'El correo electrónico ya está registrado por otro usuario.' });
      }
    }

    await run(
      `UPDATE usuarios SET nombre_completo = ?, correo = ?, password = ? WHERE id = ?`,
      [updatedName, updatedEmail, updatedPasswordHash, userId]
    );

    await logAudit(userId, 'ACTUALIZAR_PERFIL', 'El usuario actualizó su información de perfil.');

    return res.json({
      success: true,
      message: 'Perfil actualizado correctamente.',
      user: {
        id: userId,
        nombre_completo: updatedName,
        documento: currentUser.documento,
        correo: updatedEmail,
        rol_id: currentUser.rol_id,
        rol_nombre: req.user.rol_nombre,
        estado: currentUser.estado
      }
    });
  } catch (err) {
    console.error('Error en updateProfile:', err);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar perfil.'
    });
  }
}

module.exports = {
  register,
  login,
  getProfile,
  updateProfile
};
