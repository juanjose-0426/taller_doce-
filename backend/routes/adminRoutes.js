const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Todas las rutas de admin requieren rol 'superadmin' (o 'funcionario' para ciertas vistas compartidas como estadísticas)
router.use(authenticateToken);

// Dashboard y Métricas
router.get('/kpis', requireRole(['superadmin', 'funcionario']), adminController.getDashboardKPIs);
router.get('/statistics', requireRole(['superadmin']), adminController.getStatistics);

// Gestión de Usuarios
router.get('/users', requireRole(['superadmin', 'funcionario']), adminController.getUsers);
router.post('/users', requireRole(['superadmin']), adminController.createUser);
router.put('/users/:id', requireRole(['superadmin']), adminController.updateUser);
router.patch('/users/:id/toggle-status', requireRole(['superadmin']), adminController.toggleUserStatus);
router.get('/roles', requireRole(['superadmin']), adminController.getRoles);

// Configuración del Sistema
router.get('/config', requireRole(['superadmin']), adminController.getConfig);
router.put('/config', requireRole(['superadmin']), adminController.updateConfig);

// Auditoría y Reportes
router.get('/audit-logs', requireRole(['superadmin']), adminController.getAuditLogs);
router.get('/reports', requireRole(['superadmin']), adminController.getReports);

module.exports = router;
