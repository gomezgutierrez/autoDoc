'use strict';

/**
 * config.js — Carga y valida todas las variables de entorno.
 *
 * Principio: fallar rápido (fail-fast). Si falta una variable crítica,
 * el proceso lanza un error en startup antes de intentar conectarse a IMAP.
 * Esto evita errores silenciosos más adelante en el pipeline.
 */

require('dotenv').config();
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Lee una variable de entorno y lanza un error si es requerida y no existe.
 * @param {string} key
 * @param {string|undefined} defaultValue
 * @param {boolean} required
 * @returns {string}
 */
function env(key, defaultValue = undefined, required = false) {
  const value = process.env[key] ?? defaultValue;
  if (required && (value === undefined || value === '')) {
    throw new Error(
      `[config] Variable de entorno requerida no definida: ${key}\n` +
      `  → Copia .env.example a .env y rellena el valor.`
    );
  }
  return value;
}

/**
 * @typedef {Object} AppConfig
 */
const config = {
  // Entorno de ejecución
  env: env('NODE_ENV', 'development'),
  logLevel: env('LOG_LEVEL', 'info'),

  // IMAP
  imap: {
    host: env('IMAP_HOST', undefined, true),
    port: parseInt(env('IMAP_PORT', '993'), 10),
    tls: env('IMAP_TLS', 'true') === 'true',
    auth: {
      user: env('IMAP_USER', undefined, true),
      pass: env('IMAP_PASS', undefined, true),
    },
  },

  // Scheduler
  cronSchedule: env('CRON_SCHEDULE', '*/5 * * * *'),
  maxConcurrentEmails: parseInt(env('MAX_CONCURRENT_EMAILS', '3'), 10),

  // Adjuntos
  maxAttachmentSizeMb: parseFloat(env('MAX_ATTACHMENT_SIZE_MB', '25')),
  allowedMimeTypes: env(
    'ALLOWED_MIME_TYPES',
    'application/pdf,image/jpeg,image/png,image/heic,image/heif,image/jpg'
  )
    .split(',')
    .map((m) => m.trim().toLowerCase()),

  // Clasificación
  keywordConfidenceThreshold: parseFloat(
    env('KEYWORD_CONFIDENCE_THRESHOLD', '0.8')
  ),
  ocrConfidenceThreshold: parseFloat(env('OCR_CONFIDENCE_THRESHOLD', '0.65')),

  // Python
  pythonPath: env('PYTHON_PATH', 'python'),
  tesseractPath: env(
    'TESSERACT_PATH',
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe'
  ),
  pythonOcrEnabled: env('PYTHON_OCR_ENABLED', 'true') === 'true',

  // Rutas
  dataDir: env('DATA_DIR', './data'),
  logsDir: env('LOGS_DIR', './logs'),
  rootDir: ROOT_DIR,
};

module.exports = config;
