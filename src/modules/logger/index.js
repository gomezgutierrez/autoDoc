'use strict';

const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

// Importamos config de forma tardía para evitar ciclos de dependencia.
// El logger se inicializa una vez con los valores del config.
let _config = null;
function getConfig() {
  if (!_config) {
    try {
      _config = require('../../config');
    } catch {
      // Fallback seguro si config aún no está disponible (ej. durante tests)
      _config = { logLevel: 'info', logsDir: './logs', env: 'development' };
    }
  }
  return _config;
}

/**
 * Formato personalizado para la consola: legible, con colores y módulo.
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, module: mod, ...meta }) => {
    const moduleTag = mod ? ` [${mod}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}${moduleTag}: ${message}${metaStr}`;
  })
);

/**
 * Formato JSON estructurado para ficheros de log.
 * Incluye stack trace en errores.
 */
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Crea y retorna el logger singleton de Winston.
 * @returns {winston.Logger}
 */
function createLogger() {
  const cfg = getConfig();
  const logsDir = path.resolve(cfg.logsDir);

  const transports = [
    // Rotación diaria de logs en fichero
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'autoDoc-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',         // conservar 30 días
      zippedArchive: true,
      format: fileFormat,
      createSymlink: true,
      symlinkName: path.join(logsDir, 'autoDoc-current.log'),
    }),

    // Errores en fichero separado para acceso rápido a fallos
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'autoDoc-errors-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '60d',
      zippedArchive: true,
      level: 'error',
      format: fileFormat,
    }),
  ];

  // En desarrollo, agregar salida en consola con formato legible
  if (cfg.env !== 'production') {
    transports.push(
      new winston.transports.Console({
        format: consoleFormat,
      })
    );
  }

  return winston.createLogger({
    level: cfg.logLevel,
    defaultMeta: { service: 'autoDoc' },
    transports,
    exceptionHandlers: [
      new winston.transports.DailyRotateFile({
        filename: path.join(logsDir, 'autoDoc-exceptions-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        format: fileFormat,
      }),
    ],
    rejectionHandlers: [
      new winston.transports.DailyRotateFile({
        filename: path.join(logsDir, 'autoDoc-rejections-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        format: fileFormat,
      }),
    ],
  });
}

// Singleton
const logger = createLogger();

const originalChild = logger.child.bind(logger);

/**
 * Retorna un logger con el módulo ya fijado en los metadatos.
 * Uso: const log = require('../logger').child('email-reader')
 * @param {string|Object} moduleNameOrOptions
 * @returns {winston.Logger}
 */
logger.child = function (moduleNameOrOptions) {
  if (typeof moduleNameOrOptions === 'string') {
    return originalChild({ module: moduleNameOrOptions });
  }
  return originalChild(moduleNameOrOptions);
};

module.exports = logger;
