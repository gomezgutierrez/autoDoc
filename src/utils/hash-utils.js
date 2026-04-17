'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/**
 * hash-utils.js — Generación de hashes para nombres de fichero únicos.
 *
 * Usamos SHA-256 truncado a 8 caracteres como sufijo en los nombres de
 * fichero para evitar colisiones sin recurrir a UUIDs largos.
 */

/**
 * Calcula el SHA-256 de un fichero y devuelve los primeros N caracteres.
 * @param {string} filePath - Ruta absoluta al fichero
 * @param {number} [length=8] - Chars del hash a incluir (8 = 4 billion combinations)
 * @returns {Promise<string>}
 */
async function sha256OfFile(filePath, length = 8) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').slice(0, length)));
    stream.on('error', reject);
  });
}

/**
 * Calcula el SHA-256 de un Buffer.
 * @param {Buffer} buffer
 * @param {number} [length=8]
 * @returns {string}
 */
function sha256OfBuffer(buffer, length = 8) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, length);
}

module.exports = {
  sha256OfFile,
  sha256OfBuffer,
};
