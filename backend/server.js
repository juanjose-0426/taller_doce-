require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { initDatabase } = require('./config/database');
const { initSockets } = require('./sockets/socketHandler');

// Rutas
const authRoutes = require('./routes/authRoutes');
const pcRoutes = require('./routes/pcRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const queueRoutes = require('./routes/queueRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

// Guardar instancia de io en la app para controladores
app.set('io', io);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del Frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Rutas de API
app.use('/api/auth', authRoutes);
app.use('/api/pcs', pcRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

// Ruta de estado del servidor
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    app: 'BiblioTiempoDoce',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Redirigir cualquier ruta no encontrada al index del frontend para soporte SPA
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Ruta de API no encontrada.' });
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Manejo centralizado de errores
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Ha ocurrido un error interno en el servidor.',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Puerto de ejecución
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Inicializar base de datos con esquema y semillas
    await initDatabase();

    // Inicializar sockets y monitor de sesiones
    initSockets(io);

    server.listen(PORT, () => {
      console.log('====================================================');
      console.log('  🖥️  BIBLIOTIEMPODOCE - SISTEMA EN LÍNEA  🖥️');
      console.log(`  Biblioteca 12 de Octubre`);
      console.log(`  Servidor activo en: http://localhost:${PORT}`);
      console.log(`  Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log('====================================================');
    });
  } catch (err) {
    console.error('Error crítico al iniciar el servidor:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, io, startServer };
