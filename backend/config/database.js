const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
require('dotenv').config();

let dbType = 'sqlite';
let mysqlPool = null;
let sqliteDb = null;

const SQLITE_FILE = path.join(__dirname, '..', 'database', 'database.sqlite');

/**
 * Normaliza las consultas SQL para que funcionen limpiamente en MySQL y SQLite.
 */
function normalizeQueryForSqlite(sql) {
  // Convierte DATE_SUB(NOW(), INTERVAL x DAY) o NOW() si es necesario
  return sql
    .replace(/NOW\(\)/gi, "datetime('now', 'localtime')")
    .replace(/CURRENT_TIMESTAMP/gi, "datetime('now', 'localtime')")
    .replace(/DATE_SUB\(datetime\('now', 'localtime'\), INTERVAL (\d+) DAY\)/gi, "datetime('now', 'localtime', '-$1 days')");
}

async function connectMySQL() {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'bibliotiempodoce';

  try {
    // Primero probar conexión al servidor sin seleccionar base de datos
    const tempConnection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 2000
    });

    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await tempConnection.end();

    mysqlPool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Probar conexión en el pool
    const [testRows] = await mysqlPool.query('SELECT 1 + 1 AS test');
    if (testRows) {
      dbType = 'mysql';
      console.log(`✅ [DB] Conectado exitosamente a la base de datos MySQL: "${database}" en ${host}:${port}`);
      return true;
    }
  } catch (err) {
    console.warn(`⚠️ [DB] MySQL no disponible (${err.message}). Cambiando a almacenamiento relacional SQLite.`);
    return false;
  }
  return false;
}

function connectSQLite() {
  const dir = path.dirname(SQLITE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    sqliteDb = new sqlite3.Database(SQLITE_FILE, (err) => {
      if (err) {
        console.error('❌ [DB] Error al inicializar SQLite:', err.message);
        return reject(err);
      }
      dbType = 'sqlite';
      // Habilitar claves foráneas
      sqliteDb.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
        if (pragmaErr) console.warn('Aviso PRAGMA FK:', pragmaErr.message);
        console.log(`✅ [DB] Conectado exitosamente a SQLite relacional: ${SQLITE_FILE}`);
        resolve();
      });
    });
  });
}

/**
 * Ejecuta una consulta SELECT y retorna un array de filas.
 */
async function query(sql, params = []) {
  if (dbType === 'mysql' && mysqlPool) {
    const [rows] = await mysqlPool.query(sql, params);
    return rows;
  } else {
    const normalized = normalizeQueryForSqlite(sql);
    return new Promise((resolve, reject) => {
      sqliteDb.all(normalized, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
}

/**
 * Retorna una única fila o null.
 */
async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Ejecuta INSERT, UPDATE o DELETE y retorna { insertId, affectedRows }
 */
async function run(sql, params = []) {
  if (dbType === 'mysql' && mysqlPool) {
    const [result] = await mysqlPool.execute(sql, params);
    return {
      insertId: result.insertId,
      affectedRows: result.affectedRows
    };
  } else {
    const normalized = normalizeQueryForSqlite(sql);
    return new Promise((resolve, reject) => {
      sqliteDb.run(normalized, params, function(err) {
        if (err) return reject(err);
        resolve({
          insertId: this.lastID,
          affectedRows: this.changes
        });
      });
    });
  }
}

/**
 * Inicializa las tablas y datos iniciales en la base de datos
 */
async function initDatabase() {
  const preference = process.env.DB_TYPE || 'auto';

  if (preference === 'mysql' || preference === 'auto') {
    const ok = await connectMySQL();
    if (!ok && preference === 'mysql') {
      throw new Error('No se pudo conectar a MySQL y DB_TYPE está forzado a mysql.');
    }
  }

  if (dbType !== 'mysql') {
    await connectSQLite();
  }

  // Creación de tablas según el motor activo
  if (dbType === 'mysql') {
    await initMySQLTables();
  } else {
    await initSQLiteTables();
  }

  // Sembrar datos iniciales (roles, configuración, superadmin, funcionarios, usuarios y computadores)
  await seedInitialData();
}

async function initMySQLTables() {
  const ddlList = [
    `CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(50) NOT NULL UNIQUE,
      descripcion VARCHAR(255) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre_completo VARCHAR(150) NOT NULL,
      documento VARCHAR(50) NOT NULL UNIQUE,
      correo VARCHAR(150) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      rol_id INT NOT NULL,
      estado ENUM('activo', 'inactivo') DEFAULT 'activo',
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS computadores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(50) NOT NULL,
      numero INT NOT NULL UNIQUE,
      ubicacion VARCHAR(100) NOT NULL,
      estado ENUM('disponible', 'ocupado', 'proximo_terminar', 'reservado', 'fuera_servicio') DEFAULT 'disponible',
      descripcion VARCHAR(255) NULL,
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS sesiones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      computador_id INT NOT NULL,
      fecha_inicio DATETIME NOT NULL,
      fecha_fin DATETIME NULL,
      tiempo_maximo INT NOT NULL DEFAULT 60,
      tiempo_utilizado INT NOT NULL DEFAULT 0,
      estado ENUM('activa', 'proxima_finalizar', 'finalizada', 'cancelada') DEFAULT 'activa',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (computador_id) REFERENCES computadores(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS lista_espera (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      posicion INT NOT NULL,
      fecha_ingreso DATETIME DEFAULT CURRENT_TIMESTAMP,
      estado ENUM('esperando', 'asignado', 'cancelado') DEFAULT 'esperando',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS notificaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      titulo VARCHAR(150) NOT NULL,
      mensaje TEXT NOT NULL,
      estado ENUM('no_leida', 'leida') DEFAULT 'no_leida',
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS historial_acciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NULL,
      accion VARCHAR(100) NOT NULL,
      descripcion TEXT NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS configuracion (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tiempo_maximo INT NOT NULL DEFAULT 60,
      tiempo_alerta INT NOT NULL DEFAULT 15,
      reglas_lista_espera TEXT NULL,
      accion_fin_tiempo ENUM('finalizar_automatica', 'alertar_funcionario') DEFAULT 'finalizar_automatica'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  ];

  for (const sql of ddlList) {
    await mysqlPool.query(sql);
  }
}

async function initSQLiteTables() {
  const ddlList = [
    `CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      descripcion TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_completo TEXT NOT NULL,
      documento TEXT NOT NULL UNIQUE,
      correo TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      rol_id INTEGER NOT NULL,
      estado TEXT DEFAULT 'activo',
      fecha_registro TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (rol_id) REFERENCES roles(id)
    );`,

    `CREATE TABLE IF NOT EXISTS computadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      numero INTEGER NOT NULL UNIQUE,
      ubicacion TEXT NOT NULL,
      estado TEXT DEFAULT 'disponible',
      descripcion TEXT,
      fecha_registro TEXT DEFAULT (datetime('now', 'localtime'))
    );`,

    `CREATE TABLE IF NOT EXISTS sesiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      computador_id INTEGER NOT NULL,
      fecha_inicio TEXT NOT NULL,
      fecha_fin TEXT,
      tiempo_maximo INTEGER DEFAULT 60,
      tiempo_utilizado INTEGER DEFAULT 0,
      estado TEXT DEFAULT 'activa',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
      FOREIGN KEY (computador_id) REFERENCES computadores(id)
    );`,

    `CREATE TABLE IF NOT EXISTS lista_espera (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      posicion INTEGER NOT NULL,
      fecha_ingreso TEXT DEFAULT (datetime('now', 'localtime')),
      estado TEXT DEFAULT 'esperando',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );`,

    `CREATE TABLE IF NOT EXISTS notificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      estado TEXT DEFAULT 'no_leida',
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );`,

    `CREATE TABLE IF NOT EXISTS historial_acciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      accion TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );`,

    `CREATE TABLE IF NOT EXISTS configuracion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tiempo_maximo INTEGER DEFAULT 60,
      tiempo_alerta INTEGER DEFAULT 15,
      reglas_lista_espera TEXT,
      accion_fin_tiempo TEXT DEFAULT 'finalizar_automatica'
    );`
  ];

  for (const sql of ddlList) {
    await run(sql);
  }
}

async function seedInitialData() {
  // 1. Roles
  const rolesCount = await getOne('SELECT COUNT(*) as count FROM roles');
  if (!rolesCount || rolesCount.count === 0) {
    await run("INSERT INTO roles (id, nombre, descripcion) VALUES (1, 'superadmin', 'Super Administrador con control total del sistema')");
    await run("INSERT INTO roles (id, nombre, descripcion) VALUES (2, 'funcionario', 'Personal de control de la biblioteca')");
    await run("INSERT INTO roles (id, nombre, descripcion) VALUES (3, 'usuario', 'Usuario lector o visitante de la biblioteca')");
    console.log('🌱 [DB] Roles creados.');
  }

  // 2. Configuración
  const configCount = await getOne('SELECT COUNT(*) as count FROM configuracion');
  if (!configCount || configCount.count === 0) {
    await run(
      "INSERT INTO configuracion (id, tiempo_maximo, tiempo_alerta, reglas_lista_espera, accion_fin_tiempo) VALUES (1, 60, 15, ?, 'finalizar_automatica')",
      ['Orden de llegada estricto (FIFO). Tolerancia de 5 minutos al llamar al usuario.']
    );
    console.log('🌱 [DB] Configuración inicial cargada.');
  }

  // 3. Usuarios iniciales
  const usersCount = await getOne('SELECT COUNT(*) as count FROM usuarios');
  if (!usersCount || usersCount.count === 0) {
    const passwordHash = await bcrypt.hash('123456', 10);

    // Superadmin
    await run(
      'INSERT INTO usuarios (nombre_completo, documento, correo, password, rol_id, estado) VALUES (?, ?, ?, ?, ?, ?)',
      ['Administrador General 12', '1001', 'admin@biblioteca12.gov.co', passwordHash, 1, 'activo']
    );

    // Funcionario
    await run(
      'INSERT INTO usuarios (nombre_completo, documento, correo, password, rol_id, estado) VALUES (?, ?, ?, ?, ?, ?)',
      ['Carlos Gómez (Funcionario)', '2002', 'funcionario@biblioteca12.gov.co', passwordHash, 2, 'activo']
    );

    // Usuarios
    await run(
      'INSERT INTO usuarios (nombre_completo, documento, correo, password, rol_id, estado) VALUES (?, ?, ?, ?, ?, ?)',
      ['Juan Pérez', '3003', 'juan.perez@email.com', passwordHash, 3, 'activo']
    );

    await run(
      'INSERT INTO usuarios (nombre_completo, documento, correo, password, rol_id, estado) VALUES (?, ?, ?, ?, ?, ?)',
      ['María Gómez', '3004', 'maria.gomez@email.com', passwordHash, 3, 'activo']
    );

    await run(
      'INSERT INTO usuarios (nombre_completo, documento, correo, password, rol_id, estado) VALUES (?, ?, ?, ?, ?, ?)',
      ['Carlos Rodríguez', '3005', 'carlos.rodriguez@email.com', passwordHash, 3, 'activo']
    );

    console.log('🌱 [DB] Usuarios demo creados con clave "123456".');
  }

  // 4. Computadores iniciales (PC-01 a PC-12)
  const pcsCount = await getOne('SELECT COUNT(*) as count FROM computadores');
  if (!pcsCount || pcsCount.count === 0) {
    const initialPCs = [
      { num: 1, name: 'PC-01', loc: 'Sala Principal', desc: 'Intel Core i5, 16GB RAM, Windows 11', st: 'disponible' },
      { num: 2, name: 'PC-02', loc: 'Sala Principal', desc: 'Intel Core i5, 16GB RAM, Windows 11', st: 'disponible' },
      { num: 3, name: 'PC-03', loc: 'Sala Principal', desc: 'Intel Core i5, 16GB RAM, Windows 11', st: 'disponible' },
      { num: 4, name: 'PC-04', loc: 'Sala Principal', desc: 'Intel Core i7, 16GB RAM, Suite Ofimática', st: 'disponible' },
      { num: 5, name: 'PC-05', loc: 'Sala Principal', desc: 'Intel Core i7, 16GB RAM, Pantalla 24"', st: 'disponible' },
      { num: 6, name: 'PC-06', loc: 'Sala Tecnológica', desc: 'Intel Core i7, 32GB RAM, Edición Gráfica', st: 'disponible' },
      { num: 7, name: 'PC-07', loc: 'Sala Tecnológica', desc: 'Intel Core i7, 32GB RAM, Edición Gráfica', st: 'disponible' },
      { num: 8, name: 'PC-08', loc: 'Sala Tecnológica', desc: 'Intel Core i7, 32GB RAM, Programación', st: 'disponible' },
      { num: 9, name: 'PC-09', loc: 'Sala Tecnológica', desc: 'Intel Core i7, 32GB RAM, Programación', st: 'disponible' },
      { num: 10, name: 'PC-10', loc: 'Sala Infantil / Juvenil', desc: 'Intel Core i3, 8GB RAM, Software Educativo', st: 'disponible' },
      { num: 11, name: 'PC-11', loc: 'Sala Infantil / Juvenil', desc: 'Intel Core i3, 8GB RAM, Software Educativo', st: 'disponible' },
      { num: 12, name: 'PC-12', loc: 'Sala Principal', desc: 'Mantenimiento Preventivo / Reemplazo de teclado', st: 'fuera_servicio' }
    ];

    for (const pc of initialPCs) {
      await run(
        'INSERT INTO computadores (nombre, numero, ubicacion, estado, descripcion) VALUES (?, ?, ?, ?, ?)',
        [pc.name, pc.num, pc.loc, pc.st, pc.desc]
      );
    }
    console.log('🌱 [DB] 12 Computadores creados (11 disponibles, 1 fuera de servicio).');
  }

  // 5. Historial de auditoría inicial
  const logsCount = await getOne('SELECT COUNT(*) as count FROM historial_acciones');
  if (!logsCount || logsCount.count === 0) {
    await run(
      'INSERT INTO historial_acciones (usuario_id, accion, descripcion) VALUES (?, ?, ?)',
      [1, 'SISTEMA_INICIALIZADO', 'El sistema BiblioTiempoDoce ha sido inicializado correctamente para la Biblioteca 12 de Octubre.']
    );
  }
}

module.exports = {
  initDatabase,
  query,
  getOne,
  run,
  getDbType: () => dbType
};
