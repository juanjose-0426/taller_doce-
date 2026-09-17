const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Sesiones del usuario autenticado
router.get('/my-active', authenticateToken, sessionController.getMyActiveSession);
router.get('/my-history', authenticateToken, sessionController.getMyHistory);
router.post('/start', authenticateToken, sessionController.startSession);
router.post('/:id/end', authenticateToken, sessionController.endSession);

// Vistas y controles de Funcionario y Super Admin
router.get('/active', authenticateToken, requireRole(['funcionario', 'superadmin']), sessionController.getAllActiveSessions);
router.get('/history', authenticateToken, requireRole(['funcionario', 'superadmin']), sessionController.getAllHistory);
router.post('/:id/extend', authenticateToken, requireRole(['funcionario', 'superadmin']), sessionController.extendSession);

module.exports = router;
