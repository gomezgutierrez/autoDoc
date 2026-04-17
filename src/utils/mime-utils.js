'use strict';

/**
 * mime-utils.js — Utilidades para validación y normalización de tipos MIME.
 */

/** Extensiones permitidas → MIME type canónico */
const EXTENSION_TO_MIME = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

/** MIME type → extensión canónica */
const MIME_TO_EXTENSION = {
  'application/pdf': '.pdf',
  'image/jpeg':      '.jpg',
  'image/jpg':       '.jpg',   // alias no oficial pero común
  'image/png':       '.png',
  'image/heic':      '.heic',
  'image/heif':      '.heic',  // .heif y .heic son equivalentes
};

/** MIMEs que son imágenes convertibles a PDF */
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
]);

/**
 * Verifica si un MIME type está en la lista de permitidos.
 * @param {string} mimeType
 * @param {string[]} allowedList
 * @returns {boolean}
 */
function isAllowedMime(mimeType, allowedList) {
  const normalized = (mimeType || '').toLowerCase().split(';')[0].trim();
  return allowedList.some((m) => m.toLowerCase() === normalized);
}

/**
 * Retorna la extensión canónica para un MIME type.
 * @param {string} mimeType
 * @returns {string} ej. '.pdf', '.jpg', '.png'
 */
function mimeToExtension(mimeType) {
  const normalized = (mimeType || '').toLowerCase().split(';')[0].trim();
  return MIME_TO_EXTENSION[normalized] || '.bin';
}

/**
 * Infiere el MIME type a partir de la extensión del fichero.
 * @param {string} filename
 * @returns {string|null}
 */
function extensionToMime(filename) {
  const ext = (filename || '').toLowerCase().match(/\.[^.]+$/)?.[0];
  return EXTENSION_TO_MIME[ext] || null;
}

/**
 * Verifica si un MIME type corresponde a una imagen convertible a PDF.
 * @param {string} mimeType
 * @returns {boolean}
 */
function isImageMime(mimeType) {
  const normalized = (mimeType || '').toLowerCase().split(';')[0].trim();
  return IMAGE_MIMES.has(normalized);
}

/**
 * Normaliza el MIME type: limpia parámetros y aliases.
 * ej. 'image/jpeg; charset=...' → 'image/jpeg'
 * @param {string} mimeType
 * @returns {string}
 */
function normalizeMime(mimeType) {
  return (mimeType || '').toLowerCase().split(';')[0].trim();
}

module.exports = {
  isAllowedMime,
  mimeToExtension,
  extensionToMime,
  isImageMime,
  normalizeMime,
  MIME_TO_EXTENSION,
  EXTENSION_TO_MIME,
};
