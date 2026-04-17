'use strict';

const logger = require('../logger').child('document-classifier');
const config = require('../../config');
const { classifyByKeywords } = require('./keyword-classifier');
const { classifyWithPython } = require('./python-bridge');

/**
 * document-classifier/index.js
 *
 * Orquesta la clasificación en dos fases:
 *
 * FASE 1 — Keywords (siempre):
 *   Rápida, sin I/O extra. Analiza filename + subject + body.
 *   Si confidence >= KEYWORD_CONFIDENCE_THRESHOLD → clasificar y listo.
 *
 * FASE 2 — Python OCR (solo si fase 1 no supera el umbral):
 *   Invoca el script Python que hace OCR sobre el PDF y clasifica
 *   con heurísticas sobre el texto extraído.
 *   Si confidence >= OCR_CONFIDENCE_THRESHOLD → clasificar.
 *   Si no → marcar como 'revisar' para revisión manual.
 *
 * Salida por documento:
 *   {
 *     category:        string,              // 'pasaporte' | 'empadronamiento' | etc.
 *     confidence:      number (0-1),
 *     classifierPhase: 'keyword' | 'ocr',
 *     needsReview:     boolean,
 *     reviewReason:    string | null,
 *   }
 */

/**
 * Categorías válidas del sistema.
 * @type {string[]}
 */
const VALID_CATEGORIES = [
  'pasaporte',
  'empadronamiento',
  'contrato_trabajo',
  'ticket',
  'otros',
];

const { getOcrProvider } = require('../ocr-provider');
const { addPipelineStep, saveManifest } = require('../document-manifest');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Clasifica documentos.
 *
 * @param {import('../attachment-downloader').DocumentRecord[]} documents
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<import('../attachment-downloader').DocumentRecord[]>}
 */
async function classifyDocuments(documents, options = {}) {
  const results = [];

  for (const doc of documents) {
    if (doc.status !== 'processing' && doc.status !== 'pending') {
      results.push(doc);
      continue;
    }

    const startTime = Date.now();
    const logCtx = { id: doc.id, filename: doc.originalName };
    
    let manifest;
    try {
      if (doc.paths.manifest) {
        manifest = JSON.parse(await fsp.readFile(doc.paths.manifest, 'utf-8'));
      }
    } catch (e) {
      logger.error('Error cargando manifest en classifier', { id: doc.id });
    }

    // ---- FASE 1: Keywords ----
    const kwResult = classifyByKeywords({
      filename: doc.originalName,
      emailSubject: doc.metadata.emailSubject,
      emailBodyText: doc.metadata.emailBodyText || '',
    });

    if (kwResult.confidence >= config.keywordConfidenceThreshold) {
      logger.info(`✓ Clasificado por keywords: ${kwResult.category}`, logCtx);
      
      doc.classification = {
        category: kwResult.category,
        confidence: kwResult.confidence,
        method: 'keyword',
      };

      if (manifest) {
        manifest.classification = doc.classification;
        addPipelineStep(manifest, 'classification', 'ok', { phase: 'keyword', ...doc.classification }, startTime);
        await saveManifest(manifest, path.dirname(doc.paths.manifest));
      }

      results.push(doc);
      continue;
    }

    // ---- FASE 2: OCR ----
    if (config.pythonOcrEnabled && doc.paths.current && doc.mimeType === 'application/pdf') {
      logger.info('Invocando provider OCR para clasificación...', logCtx);
      
      const ocrProvider = getOcrProvider();
      const ocrResult = await ocrProvider.extractText(doc.paths.current);

      if (ocrResult.success) {
        // Ejecutar lógica de clasificación sobre el texto del OCR
        // Nota: reusamos classifyByKeywords pero con el texto del OCR como body
        const ocrClassified = classifyByKeywords({
          filename: doc.originalName,
          emailSubject: doc.metadata.emailSubject,
          emailBodyText: ocrResult.text,
        });

        doc.classification = {
          category: ocrClassified.category,
          confidence: ocrClassified.confidence,
          method: `ocr:${ocrProvider.name}`,
          ocrTextSnippet: ocrResult.textSnippet,
        };

        if (ocrClassified.confidence < config.ocrConfidenceThreshold) {
          doc.status = 'review';
          doc.metadata.reviewReason = `Baja confianza OCR (${(ocrClassified.confidence * 100).toFixed(1)}%)`;
        }

        if (manifest) {
          manifest.classification = doc.classification;
          if (doc.status === 'review') manifest.status = 'review';
          addPipelineStep(manifest, 'classification', 'ok', { phase: 'ocr', engine: ocrProvider.name, ...doc.classification }, startTime);
          await saveManifest(manifest, path.dirname(doc.paths.manifest));
        }
      } else {
        doc.status = 'review';
        doc.metadata.reviewReason = `Fallo OCR: ${ocrResult.error}`;
        if (manifest) {
          manifest.status = 'review';
          addPipelineStep(manifest, 'classification', 'error', { error: ocrResult.error }, startTime);
          await saveManifest(manifest, path.dirname(doc.paths.manifest));
        }
      }
      results.push(doc);
    } else {
      // Incierto y sin OCR disponible
      doc.status = 'review';
      doc.classification = {
        category: kwResult.category,
        confidence: kwResult.confidence,
        method: 'keyword',
      };
      doc.metadata.reviewReason = 'Confianza keyword insuficiente y OCR no disponible';

      if (manifest) {
        manifest.status = 'review';
        manifest.classification = doc.classification;
        addPipelineStep(manifest, 'classification', 'uncertain', { reason: 'low_confidence_no_ocr' }, startTime);
        await saveManifest(manifest, path.dirname(doc.paths.manifest));
      }
      results.push(doc);
    }
  }

  return results;
}

module.exports = { classifyDocuments, VALID_CATEGORIES };
