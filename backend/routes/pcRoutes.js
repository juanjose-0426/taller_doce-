const express = require('express');
const router = express.Router();
const pcController = require('../controllers/pcController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Consultas de computadores (requiere estar autenticado)
router.get('/', authenticateToken, pcController.getAllPCs);
router.get('/available', authenticateToken, pcController.getAvailablePCs);
router.get('/:id', authenticateToken, pcController.getPCById);
router.get('/:id/history', authenticateToken, requireRole(['funcionario', 'superadmin']), pcController.getPCHistory);

// Acciones administrativas y de control de personal
router.post('/', authenticateToken, requireRole(['superadmin']), pcController.createPC);
router.put('/:id', authenticateToken, requireRole(['superadmin']), pcController.updatePC);
router.delete('/:id', authenticateToken, requireRole(['superadmin']), pcController.deletePC);
router.patch('/:id/status', authenticateToken, requireRole(['funcionario', 'superadmin']), pcController.changeStatus);

module.exports = router;
