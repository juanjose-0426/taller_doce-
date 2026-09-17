-- ==========================================================
-- SISTEMA DE GESTIÓN Y CONTROL DE COMPUTADORES
-- BIBLIOTECA 12 DE OCTUBRE - BIBLIOTIEMPODOCE
-- Script de Creación de Base de Datos y Datos Iniciales
-- ==========================================================

CREATE DATABASE IF NOT EXISTS bibliotiempodoce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bibliotiempodoce;

-- 1. Tabla: roles
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE,
  descripcion VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Tabla: usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_completo VARCHAR(150) NOT NULL,
  documento VARCHAR(50) NOT NULL UNIQUE,
  correo VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  rol_id INT NOT NULL,
  estado ENUM('activo', 'inactivo') DEFAULT 'activo',
  fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Tabla: computadores
CREATE TABLE IF NOT EXISTS computadores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL,
  numero INT NOT NULL UNIQUE,
  ubicacion VARCHAR(100) NOT NULL,
  estado ENUM('disponible', 'ocupado', 'proximo_terminar', 'reservado', 'fuera_servicio') DEFAULT 'disponible',
  descripcion VARCHAR(255) NULL,
  fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Tabla: sesiones
CREATE TABLE IF NOT EXISTS sesiones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  computador_id INT NOT NULL,
  fecha_inicio DATETIME NOT NULL,
  fecha_fin DATETIME NULL,
  tiempo_maximo INT NOT NULL DEFAULT 60, -- en minutos
  tiempo_utilizado INT NOT NULL DEFAULT 0, -- en segundos
  estado ENUM('activa', 'proxima_finalizar', 'finalizada', 'cancelada') DEFAULT 'activa',
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (computador_id) REFERENCES computadores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Tabla: lista_espera
CREATE TABLE IF NOT EXISTS lista_espera (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  posicion INT NOT NULL,
  fecha_ingreso DATETIME DEFAULT CURRENT_TIMESTAMP,
  estado ENUM('esperando', 'asignado', 'cancelado') DEFAULT 'esperando',
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Tabla: notificaciones
CREATE TABLE IF NOT EXISTS notificaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  titulo VARCHAR(150) NOT NULL,
  mensaje TEXT NOT NULL,
  estado ENUM('no_leida', 'leida') DEFAULT 'no_leida',
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Tabla: historial_acciones (Auditoría)
CREATE TABLE IF NOT EXISTS historial_acciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  accion VARCHAR(100) NOT NULL,
  descripcion TEXT NOT NULL,
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Tabla: configuracion
CREATE TABLE IF NOT EXISTS configuracion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tiempo_maximo INT NOT NULL DEFAULT 60, -- minutos
  tiempo_alerta INT NOT NULL DEFAULT 15, -- minutos de aviso previo
  reglas_lista_espera TEXT NULL,
  accion_fin_tiempo ENUM('finalizar_automatica', 'alertar_funcionario') DEFAULT 'finalizar_automatica'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ==========================================================
-- DATOS INICIALES (SEEDS)
-- ==========================================================

-- Roles del sistema
INSERT INTO roles (id, nombre, descripcion) VALUES
(1, 'superadmin', 'Control absoluto del sistema y administración general'),
(2, 'funcionario', 'Personal de control de sala y asignación de equipos'),
(3, 'usuario', 'Usuario lector / visitante de la biblioteca')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Configuración por defecto
INSERT INTO configuracion (id, tiempo_maximo, tiempo_alerta, reglas_lista_espera, accion_fin_tiempo) VALUES
(1, 60, 15, 'Orden de llegada estricto (FIFO). Si el usuario no responde en 5 minutos tras ser llamado, se cede el turno al siguiente.', 'finalizar_automatica')
ON DUPLICATE KEY UPDATE tiempo_maximo = VALUES(tiempo_maximo);

-- Usuarios por defecto (Contraseña para todos: '123456')
-- Hash bcrypt para '123456': $2a$10$wE9K2jT7gqF6L8yXwVz4g.aB0Nl5f9H3i7u8v6s4m2k1l0o9p8q7r (o generado por seed)
