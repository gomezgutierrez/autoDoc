'use strict';

const path = require('path');
const logger = require('../logger').child('expedient-organizer');
const config = require('../../config');
const { ensureDir, safeMove } = require('../../utils/file-utils');
const { VALID_CATEGORIES } = require('../document-classifier');

/**
 * expedient-organizer/index.js
 *
 * Mueve los documentos clasificados y renombrados a sus carpetas de destino
 * dentro de data/processed/{categoria}/.
 *
 * Estructura de salida:
 *   data/
 *   └── processed/
 *       ├── pasaporte/
 *       ├── empadronamiento/
 *       ├── contrato_trabajo/
 *       ├── ticket/
 *       └── otros/
 *
 * Solo mueve documentos con needsReview=false.
 * Los que tienen needsReview=true son gestionados por manual-review-manager.
 *
 * Retorna cada adjunto enriquecido con `finalPath`: la ruta absoluta donde
 * quedó el fichero después de moverlo.
 */

const { addPipelineStep, saveManifest } = require('../document-manifest');
const { registerHash } = require('../deduplicator');
const fsp = require('fs/promises');

/**
 * Organiza los documentos en carpetas por expediente y categoría.
 *
 * Estructura: data/processed/{expedienteId}/{categoria}/{fichero}
 *
 * @param {import('../attachment-downloader').DocumentRecord[]} documents
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<import('../attachment-downloader').DocumentRecord[]>}
 */
async function organizeDocuments(documents, options = {}) {
  const results = [];

  for (const doc of documents) {
    if (doc.status !== 'processing' && doc.status !== 'pending' && doc.status !== 'done') {
      results.push(doc);
      continue;
    }

    const startTime = Date.now();
    const expedienteId = doc.metadata.expedienteId || '_general';
    const category = doc.classification.category || 'otros';
    const logCtx = { id: doc.id, category, expedienteId };

    let manifest;
    try {
      if (doc.paths.manifest) {
        manifest = JSON.parse(await fsp.readFile(doc.paths.manifest, 'utf-8'));
      }
    } catch (e) {
      logger.error('Error cargando manifest en organizer', { id: doc.id });
    }

    try {
      const destDir = path.resolve(config.dataDir, 'processed', expedienteId, category);
      await ensureDir(destDir);

      const filename = doc.metadata.renamedFilename || `${doc.id}.pdf`;
      const destPath = path.join(destDir, filename);

      if (!options.dryRun) {
        // Mover PDF
        doc.paths.final = await safeMove(doc.paths.current, destPath);
        
        // Mover Manifest si existe
        if (doc.paths.manifest) {
          const manifestDestPath = path.join(destDir, path.basename(doc.paths.manifest));
          await safeMove(doc.paths.manifest, manifestDestPath);
          doc.paths.manifest = manifestDestPath;
        }

        doc.status = 'done';

        // Actualizar manifest final
        if (manifest) {
          manifest.status = 'done';
          manifest.result = {
            finalPath: doc.paths.final,
            renamedFilename: filename,
            expedienteId
          };
          addPipelineStep(manifest, 'organize', 'ok', { dest: destPath }, startTime);
          await saveManifest(manifest, destDir);
        }

        // Registrar hash para futura deduplicación
        if (doc.hash) {
          await registerHash(doc.hash, {
            originalName: doc.originalName,
            finalPath: doc.paths.final,
            emailMessageId: manifest?.origin?.emailMessageId
          });
        }

        logger.info(`Organizado exitosamente en ${expedienteId}/${category}`, logCtx);
      } else {
        logger.info(`[DRY-RUN] Organizaría en ${expedienteId}/${category}`, logCtx);
      }

      results.push(doc);
    } catch (err) {
      logger.error('Error organizando documento', { ...logCtx, error: err.message });
      doc.status = 'error';
      doc.errors.push(`Organization error: ${err.message}`);
      if (manifest) {
        manifest.status = 'error';
        addPipelineStep(manifest, 'organize', 'error', { error: err.message }, startTime);
        await saveManifest(manifest, path.dirname(doc.paths.manifest));
      }
      results.push(doc);
    }
  }

  return results;
}

module.exports = { organizeDocuments };
