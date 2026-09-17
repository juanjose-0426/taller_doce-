const jwt = require('jsonwebtoken');
const { getOne } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'bibliotiempodoce_secret_key_jwt_2026_biblioteca_12_octubre';

/**
 * Middleware para verificar token JWT
 */
async function authenticateToken(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Acceso no autorizado: No se proporcionó token de autenticación.'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Validar usuario en base de datos
    const user = await getOne(
      `SELECT u.id, u.nombre_completo, u.documento, u.correo, u.rol_id, u.estado, r.nombre AS rol_nombre
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no encontrado o sesión inválida.'
      });
    }

    if (user.estado !== 'activo') {
      return res.status(403).json({
        success: false,
        message: 'Cuenta desactivada. Contacte al personal de la biblioteca.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado. Inicie sesión nuevamente.'
    });
  }
}

/**
 * Middleware para validar roles específicos
 * @param {Array<string>} allowedRoles Lista de nombres de roles permitidos (ej: ['superadmin', 'funcionario'])
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'No autenticado.'
      });
    }

    if (!allowedRoles.includes(req.user.rol_nombre)) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: Se requiere rol [${allowedRoles.join(', ')}]. Tu rol actual es [${req.user.rol_nombre}].`
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole,
  JWT_SECRET
};
