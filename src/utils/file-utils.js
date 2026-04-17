'use strict';

const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');

/**
 * file-utils.js — Operaciones de sistema de ficheros seguras y reutilizables.
 *
 * Todas las operaciones están diseñadas para ser idempotentes y seguras
 * frente a rutas inexistentes o conflictos de nombre.
 */

/**
 * Crea un directorio recursivamente si no existe.
 * Idempotente: no lanza error si ya existe.
 * @param {string} dirPath
 * @returns {Promise<void>}
 */
async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

/**
 * Mueve un fichero de src a dest de forma segura.
 * Si dest ya existe, añade un sufijo numérico para evitar sobreescritura.
 * @param {string} src
 * @param {string} dest
 * @returns {Promise<string>} ruta final donde quedó el fichero
 */
async function safeMove(src, dest) {
  await ensureDir(path.dirname(dest));

  let finalDest = dest;
  let counter = 1;

  while (fs.existsSync(finalDest)) {
    const ext = path.extname(dest);
    const base = path.basename(dest, ext);
    const dir = path.dirname(dest);
    finalDest = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  }

  await fsp.rename(src, finalDest);
  return finalDest;
}

/**
 * Copia un fichero de src a dest de forma segura.
 * Si dest ya existe, añade sufijo numérico.
 * @param {string} src
 * @param {string} dest
 * @returns {Promise<string>} ruta final del fichero copiado
 */
async function safeCopy(src, dest) {
  await ensureDir(path.dirname(dest));

  let finalDest = dest;
  let counter = 1;

  while (fs.existsSync(finalDest)) {
    const ext = path.extname(dest);
    const base = path.basename(dest, ext);
    const dir = path.dirname(dest);
    finalDest = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  }

  await fsp.copyFile(src, finalDest);
  return finalDest;
}

/**
 * Elimina un fichero de forma segura (no lanza si no existe).
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function deleteFile(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Sanitiza el nombre de un fichero para uso en el sistema de ficheros:
 * - Elimina caracteres peligrosos (path traversal, inyección)
 * - Trunca a 200 caracteres
 * - Sustituye espacios por underscore
 * @param {string} filename
 * @returns {string}
 */
function getSafeFilename(filename) {
  return (filename || 'unnamed')
    .replace(/[/\\:*?"<>|]/g, '_')  // Chars ilegales en Windows
    .replace(/\.\./g, '__')          // Path traversal
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 200);
}

/**
 * Retorna el tamaño de un fichero en bytes.
 * Devuelve 0 si el fichero no existe.
 * @param {string} filePath
 * @returns {Promise<number>}
 */
async function getFileSize(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

module.exports = {
  ensureDir,
  safeMove,
  safeCopy,
  deleteFile,
  getSafeFilename,
  getFileSize,
};
