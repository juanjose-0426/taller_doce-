const express = require('express');
const router = express.Router();
const queueController = require('../controllers/queueController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Consultas y acciones del usuario
router.get('/my-position', authenticateToken, queueController.getMyPosition);
router.post('/join', authenticateToken, queueController.joinQueue);
router.post('/leave', authenticateToken, queueController.leaveQueue);

// Funciones del personal de control
router.get('/', authenticateToken, requireRole(['funcionario', 'superadmin']), queueController.getQueue);
router.post('/assign', authenticateToken, requireRole(['funcionario', 'superadmin']), queueController.assignNextUser);

module.exports = router;
