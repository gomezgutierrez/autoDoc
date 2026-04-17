'use strict';

const path = require('path');
const fsp = require('fs/promises');
const logger = require('../logger').child('manual-review-manager');
const config = require('../../config');
const { ensureDir, safeCopy, safeMove } = require('../../utils/file-utils');
const { formatDateForFilename } = require('../file-renamer');

/**
 * manual-review-manager/index.js
 *
 * Gestiona los documentos que no han podido clasificarse con suficiente confianza.
 *
 * Para cada documento a revisar, crea una carpeta individual en data/review/:
 *
 *   data/review/
 *   └── 20260417_1432_{originalName}/
 *       ├── documento.pdf       ← el fichero a revisar
 *       └── metadata.json       ← contexto completo para el abogado
 *
 * ## Contenido de metadata.json:
 * Proporciona al abogado toda la información necesaria para resolver
 * la clasificación manualmente sin tener que buscar en los logs:
 *
 *   {
 *     "id":              "uuid del proceso",
 *     "originalFile":    "nombre original del adjunto",
 *     "emailFrom":       "remitente",
 *     "emailSubject":    "asunto",
 *     "emailDate":       "2026-04-17T...",
 *     "reviewReason":    "por qué se envió a revisión",
 *     "category":        "mejor categoría estimada",
 *     "confidence":      0.45,
 *     "classifierPhase": "keyword | ocr",
 *     "ocrTextSnippet":  "texto extraído (si aplica)",
 *     "processedAt":     "2026-04-17T..."
 *   }
 *
 * ## Flujo esperado por el abogado:
 * 1. Abrir data/review/ y revisar las carpetas por fecha
 * 2. Leer metadata.json para contexto
 * 3. Abrir documento.pdf
 * 4. Mover manualmente a la carpeta data/processed/{categoria}/ correcta
 */

const { addPipelineStep, saveManifest } = require('../document-manifest');

/**
 * Procesa los documentos marcados como status='review'.
 *
 * @param {import('../attachment-downloader').DocumentRecord[]} documents
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<import('../attachment-downloader').DocumentRecord[]>}
 */
async function sendToManualReview(documents, options = {}) {
  const reviewBase = path.resolve(config.dataDir, 'review');
  await ensureDir(reviewBase);

  const results = [];
  const toReview = documents.filter((d) => d.status === 'review' || d.status === 'error');

  for (const doc of toReview) {
    const startTime = Date.now();
    const logCtx = { id: doc.id, filename: doc.originalName };

    try {
      const datePart = formatDateForFilename(doc.metadata.emailDate);
      const sanitizedOriginal = (doc.originalName || 'documento')
        .replace(/[^a-z0-9._-]/gi, '_')
        .slice(0, 50);

      // Si tenemos una categoría estimada (aunque sea de baja confianza), la usamos en el nombre de la carpeta
      const catLabel = (doc.category && doc.category !== 'otros') 
        ? `POSIBLE_${doc.category.toUpperCase()}` 
        : 'SIN_CLASIFICAR';

      const folderName = `${datePart}_${catLabel}_${doc.id.slice(0, 4)}`;
      const reviewDir  = path.join(reviewBase, folderName);

      await ensureDir(reviewDir);

      const srcPath = doc.paths.current;
      // Mantener el nombre original del archivo pero asegurar extensión .pdf si fue convertido
      const finalFileName = sanitizedOriginal.toLowerCase().endsWith('.pdf') 
        ? sanitizedOriginal 
        : `${sanitizedOriginal}.pdf`;
        
      const destPdf = path.join(reviewDir, finalFileName);
      
      let manifest;
      try {
        if (doc.paths.manifest) {
          manifest = JSON.parse(await fsp.readFile(doc.paths.manifest, 'utf-8'));
        }
      } catch (e) {
        // Ignorar si no hay manifest previo
      }

      if (!options.dryRun) {
        // Mover PDF
        await safeMove(srcPath, destPdf);
        doc.paths.current = destPdf;
        doc.paths.final = destPdf;

        if (manifest) {
          manifest.status = doc.status;
          manifest.reviewReason = doc.metadata.reviewReason || 'Error desconocido';
          addPipelineStep(manifest, 'review', 'ok', { reviewDir }, startTime);
          
          // Guardar como metadata.json para facilitar lectura al abogado
          const metaPath = path.join(reviewDir, 'metadata.json');
          await fsp.writeFile(metaPath, JSON.stringify(manifest, null, 2), 'utf-8');
          
          // Eliminar manifest antiguo si existiera uno suelto
          if (doc.paths.manifest) {
            await fsp.unlink(doc.paths.manifest).catch(() => {});
          }
          doc.paths.manifest = metaPath;
        }

        logger.warn(`⚠ Enviado a revisión manual: ${folderName}`, logCtx);
      } else {
        logger.info(`[DRY-RUN] Enviaría a revisión manual: ${folderName}`, logCtx);
      }

      results.push(doc);
    } catch (err) {
      logger.error('Error enviando a revisión manual', { ...logCtx, error: err.message });
      results.push(doc);
    }
  }

  return results;
}

module.exports = { sendToManualReview };

module.exports = { sendToManualReview };
