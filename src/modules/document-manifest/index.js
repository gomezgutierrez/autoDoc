'use strict';

const path = require('path');
const fsp = require('fs/promises');
const logger = require('../logger').child('document-manifest');
const config = require('../../config');
const { ensureDir } = require('../../utils/file-utils');

/**
 * document-manifest/index.js
 *
 * Crea y actualiza el manifest JSON de trazabilidad por documento.
 *
 * Cada documento procesado tiene un manifest con:
 *   - Origen (email completo)
 *   - Historial de pasos ejecutados con timestamps y resultados
 *   - Estado actual del pipeline
 *   - Clasificación y confianza
 *   - Errores encontrados
 *   - Ruta final del documento
 *
 * ## Ubicación del manifest:
 * Se guarda junto al fichero PDF final en su carpeta de destino.
 * En caso de revisión manual, se guarda en la carpeta de review.
 *
 * Nombre: `{hash8}.manifest.json`
 *
 * ## Estructura:
 * {
 *   "version": "1.0",
 *   "documentId": "uuid",
 *   "hash": "sha256-completo",
 *   "status": "done | error | review | duplicate",
 *   "origin": {
 *     "emailMessageId": "...",
 *     "emailFrom": "...",
 *     "emailSubject": "...",
 *     "emailDate": "ISO",
 *     "originalFilename": "...",
 *     "originalMimeType": "...",
 *     "originalSizeBytes": 0
 *   },
 *   "pipeline": [
 *     { "step": "download", "status": "ok", "at": "ISO", "durationMs": 12 },
 *     { "step": "normalize", "status": "ok", "at": "ISO", "durationMs": 450 },
 *     ...
 *   ],
 *   "classification": {
 *     "category": "pasaporte",
 *     "confidence": 0.875,
 *     "method": "keyword | ocr",
 *     "ocrEngine": "tesseract | paddleocr | null",
 *     "ocrTextSnippet": "..."
 *   },
 *   "result": {
 *     "finalPath": "data/processed/...",
 *     "renamedFilename": "20260417_...",
 *     "expedienteId": "_general"
 *   },
 *   "errors": [],
 *   "processedAt": "ISO",
 *   "reviewReason": null
 * }
 *
 * @typedef {Object} ManifestData
 */

/**
 * Crea un manifest inicial para un documento (al inicio del pipeline).
 *
 * @param {Object} doc - DocumentRecord parcial
 * @returns {ManifestData}
 */
function createManifest(doc) {
  return {
    version: '1.0',
    documentId: doc.id,
    hash: doc.hash || null,
    status: 'processing',
    origin: {
      emailMessageId: doc.emailMessageId,
      emailFrom: doc.emailFrom,
      emailSubject: doc.emailSubject,
      emailDate: doc.emailDate instanceof Date
        ? doc.emailDate.toISOString()
        : doc.emailDate,
      originalFilename: doc.originalName,
      originalMimeType: doc.mimeType,
      originalSizeBytes: doc.sizeBytes,
    },
    pipeline: [],
    classification: null,
    result: null,
    errors: [],
    processedAt: null,
    reviewReason: null,
  };
}

/**
 * Añade un paso al historial del manifest.
 *
 * @param {ManifestData} manifest
 * @param {string} step          - nombre del paso (ej. 'normalize')
 * @param {'ok'|'error'|'skipped'} status
 * @param {Object} [details]     - datos adicionales del paso
 * @param {number} [startTime]   - Date.now() del inicio del paso
 * @returns {ManifestData}
 */
function addPipelineStep(manifest, step, status, details = {}, startTime = null) {
  manifest.pipeline.push({
    step,
    status,
    at: new Date().toISOString(),
    durationMs: startTime ? Date.now() - startTime : null,
    ...details,
  });
  return manifest;
}

/**
 * Guarda el manifest en disco junto al documento.
 *
 * @param {ManifestData} manifest
 * @param {string} destDir - Directorio donde guardar el manifest
 * @returns {Promise<string>} ruta del manifest guardado
 */
async function saveManifest(manifest, destDir) {
  await ensureDir(destDir);
  const shortHash = manifest.hash ? manifest.hash.slice(0, 8) : manifest.documentId.slice(0, 8);
  const manifestPath = path.join(destDir, `${shortHash}.manifest.json`);
  manifest.processedAt = new Date().toISOString();
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  logger.info(`Manifest guardado: ${path.basename(manifestPath)}`, {
    documentId: manifest.documentId,
    status: manifest.status,
    dir: destDir,
  });
  return manifestPath;
}

module.exports = { createManifest, addPipelineStep, saveManifest };
