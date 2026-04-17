'use strict';

const path = require('path');
const logger = require('../logger').child('file-renamer');
const { sha256OfFile } = require('../../utils/hash-utils');

/**
 * file-renamer/index.js
 *
 * Genera nombres de fichero normalizados y consistentes para los documentos
 * procesados, usando el patrón:
 *
 *   {YYYYMMDD}_{HHmm}_{categoria}_{hash8}.pdf
 *
 * Ejemplo:
 *   20260417_1432_pasaporte_3f8a12bc.pdf
 *
 * ## Ventajas de este patrón:
 * - Ordenación cronológica por nombre (ls/dir es suficiente)
 * - Categoría legible a simple vista
 * - Hash de 8 chars evita colisiones sin UUIDs largos
 * - Extension siempre .pdf (todos los documentos ya están convertidos)
 *
 * Nota: Este módulo NO mueve el fichero. Solo calcula el nombre destino.
 * El movimiento físico lo hace expedient-organizer.
 */

/**
 * Formatea una fecha como string compacto para el nombre de fichero.
 * @param {Date} date
 * @returns {string} ej. '20260417_1432'
 */
function formatDateForFilename(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');

  const year  = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day   = pad(d.getDate());
  const hour  = pad(d.getHours());
  const min   = pad(d.getMinutes());

  return `${year}${month}${day}_${hour}${min}`;
}

/**
 * Sanitiza una categoría para uso en nombre de fichero.
 * @param {string} category
 * @returns {string}
 */
function sanitizeCategory(category) {
  return (category || 'otros')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 40);
}

/**
 * Calcula el nombre de fichero normalizado para un documento.
 *
 * @param {import('../attachment-downloader').DocumentRecord} doc
 * @returns {Promise<string>}
 */
async function computeRenamedFilename(doc) {
  const datePart     = formatDateForFilename(doc.metadata.emailDate);
  const categoryPart = sanitizeCategory(doc.classification.category);
  const hashPart     = (doc.hash ? doc.hash.slice(0, 8) : await sha256OfFile(doc.paths.current)).toLowerCase();

  return `${datePart}_${categoryPart}_${hashPart}.pdf`;
}

/**
 * Enriquece cada adjunto clasificado con su nombre de fichero normalizado.
 *
 * @param {import('../attachment-downloader').DocumentRecord[]} documents
 * @returns {Promise<import('../attachment-downloader').DocumentRecord[]>}
 */
async function renameDocuments(documents) {
  const results = [];

  for (const doc of documents) {
    if (doc.status !== 'processing' && doc.status !== 'pending' && doc.status !== 'done') {
      results.push(doc);
      continue;
    }

    const logCtx = { id: doc.id, original: doc.originalName };

    try {
      doc.metadata.renamedFilename = await computeRenamedFilename(doc);
      logger.info(`Nombre calculado: ${doc.metadata.renamedFilename}`, logCtx);
      results.push(doc);
    } catch (err) {
      logger.error('Error calculando nombre normalizado', { ...logCtx, error: err.message });
      const fallback = `${Date.now()}_${doc.id.slice(0, 8)}_otros.pdf`;
      doc.metadata.renamedFilename = fallback;
      results.push(doc);
    }
  }

  return results;
}

module.exports = { renameDocuments, formatDateForFilename };
