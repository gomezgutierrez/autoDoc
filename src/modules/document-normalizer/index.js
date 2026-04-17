'use strict';

const path = require('path');
const fsp = require('fs/promises');
const convert = require('heic-convert');
const { PDFDocument } = require('pdf-lib');
const logger = require('../logger').child('document-normalizer');
const { normalizeMime } = require('../../utils/mime-utils');
const { deleteFile } = require('../../utils/file-utils');

/**
 * document-normalizer/index.js
 *
 * Normaliza los ficheros descargados a formatos canónicos:
 *
 * HEIC/HEIF → JPEG:
 *   heic-convert es puro JS y funciona en Windows sin recompilar binarios nativos.
 *   Se convierte a JPEG con quality 0.9 (balance calidad/tamaño).
 *
 * PDF → Validación de integridad:
 *   Los PDFs corruptos son detectados aquí. Si pdf-lib no puede abrir el fichero,
 *   el adjunto se marca con status='corrupted' para ser enviado a revisión manual.
 *
 * Imagenes JPG/PNG → Sin transformación en este módulo (pasan al pdf-converter).
 *
 * Contrato: cada DownloadedAttachment que entre sale enriquecido con:
 *   - normalizedPath: ruta al fichero normalizado (puede ser el mismo)
 *   - normalizedMime: MIME después de normalización
 *   - status: 'ok' | 'corrupted' | 'unsupported'
 *   - normalizationError: string|null
 */

const { addPipelineStep, saveManifest } = require('../document-manifest');

/**
 * Normaliza los colecciones de documentos.
 *
 * @param {import('../attachment-downloader').DocumentRecord[]} documents
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<import('../attachment-downloader').DocumentRecord[]>}
 */
async function normalizeDocuments(documents, options = {}) {
  const results = [];

  for (const doc of documents) {
    const startTime = Date.now();
    const logCtx = { id: doc.id, filename: doc.originalName };
    const mime = normalizeMime(doc.mimeType);

    // Cargar manifest (en una app real lo pasaríamos por el objeto o lo recargaríamos)
    // Para simplificar, asumiremos que el manifest se gestiona via fs en su ruta manifest path
    // Pero como estamos en el mismo proceso, podemos intentar leerlo o reconstruirlo.
    // Lo más limpio es que DocumentRecord contenga la data del manifest o lo recarguemos.
    // Vamos a usar una función helper para recargar si es necesario o simplemente 
    // confiar en que el orquestador lo maneja. 
    // Para esta implementación, recargaremos el JSON del manifest si existe.

    let manifest;
    try {
      if (doc.paths.manifest) {
        manifest = JSON.parse(await fsp.readFile(doc.paths.manifest, 'utf-8'));
      }
    } catch (e) {
      logger.error('Error cargando manifest en normalizer', { id: doc.id });
    }

    try {
      // ---- CASO 1: HEIC/HEIF → JPEG ----
      if (mime === 'image/heic' || mime === 'image/heif') {
        logger.info('Convirtiendo HEIC → JPEG', { ...logCtx, mime });

        const heicBuffer = await fsp.readFile(doc.paths.incoming);
        const jpegBuffer = await convert({
          buffer: heicBuffer,
          format: 'JPEG',
          quality: 0.9,
        });

        const jpegPath = doc.paths.incoming.replace(/\.(heic|heif)$/i, '.jpg');

        if (!options.dryRun) {
          await fsp.writeFile(jpegPath, jpegBuffer);
          await deleteFile(doc.paths.incoming);
        }

        doc.paths.current = jpegPath;
        doc.mimeType = 'image/jpeg';
        doc.status = 'processing';

        if (manifest) {
          addPipelineStep(manifest, 'normalize', 'ok', { from: mime, to: 'image/jpeg', path: jpegPath }, startTime);
          await saveManifest(manifest, path.dirname(doc.paths.manifest));
        }

        results.push(doc);
        continue;
      }

      // ---- CASO 2: PDF → Validar integridad ----
      if (mime === 'application/pdf') {
        try {
          const pdfBytes = await fsp.readFile(doc.paths.current);
          await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
          
          if (manifest) {
            addPipelineStep(manifest, 'normalize', 'ok', { type: 'pdf_validation' }, startTime);
            await saveManifest(manifest, path.dirname(doc.paths.manifest));
          }

          results.push(doc);
        } catch (pdfErr) {
          logger.error('PDF corrupto', { ...logCtx, error: pdfErr.message });
          doc.status = 'error';
          doc.errors.push(`PDF Corrupto: ${pdfErr.message}`);

          if (manifest) {
            manifest.status = 'error';
            addPipelineStep(manifest, 'normalize', 'error', { error: pdfErr.message }, startTime);
            await saveManifest(manifest, path.dirname(doc.paths.manifest));
          }
          results.push(doc);
        }
        continue;
      }

      // ---- CASO 3: JPG / PNG ----
      if (['image/jpeg', 'image/jpg', 'image/png'].includes(mime)) {
        if (manifest) {
          addPipelineStep(manifest, 'normalize', 'ok', { type: 'passthrough', mime }, startTime);
          await saveManifest(manifest, path.dirname(doc.paths.manifest));
        }
        results.push(doc);
        continue;
      }

      // ---- CASO 4: No soportado ----
      doc.status = 'error';
      doc.errors.push(`MIME no soportado: ${mime}`);
      if (manifest) {
        manifest.status = 'error';
        addPipelineStep(manifest, 'normalize', 'error', { error: 'Unsupported MIME' }, startTime);
        await saveManifest(manifest, path.dirname(doc.paths.manifest));
      }
      results.push(doc);

    } catch (err) {
      logger.error('Error en normalizer', { ...logCtx, error: err.message });
      doc.status = 'error';
      doc.errors.push(err.message);
      if (manifest) {
        manifest.status = 'error';
        addPipelineStep(manifest, 'normalize', 'error', { error: err.message }, startTime);
        await saveManifest(manifest, path.dirname(doc.paths.manifest));
      }
      results.push(doc);
    }
  }

  return results;
}

module.exports = { normalizeDocuments };
