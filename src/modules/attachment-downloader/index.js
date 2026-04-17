'use strict';

const path = require('path');
const fsp = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger').child('attachment-downloader');
const config = require('../../config');
const { isAllowedMime, mimeToExtension, extensionToMime, normalizeMime } = require('../../utils/mime-utils');
const { ensureDir, getSafeFilename } = require('../../utils/file-utils');

/**
 * attachment-downloader/index.js
 *
 * Procesa adjuntos de emails y los descarga a /incoming.
 * Crea las entidades EmailRecord y DocumentRecord.
 *
 * @typedef {Object} DocumentRecord
 * @property {string} id
 * @property {string|null} hash
 * @property {string} status - 'pending'|'processing'|'done'|'error'|'review'|'duplicate'
 * @property {string} originalName
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {Object} paths - { incoming, current, final, manifest }
 * @property {Object} classification - { category, confidence, method }
 * @property {string[]} errors
 * @property {Object} metadata
 *
 * @typedef {Object} EmailRecord
 * @property {number} uid
 * @property {string} messageId
 * @property {string} from
 * @property {string} subject
 * @property {Date} date
 * @property {string} bodyText
 * @property {DocumentRecord[]} documents
 */

const { createManifest, saveManifest, addPipelineStep } = require('../document-manifest');

/**
 * Procesa un array de emails parseados y guarda los adjuntos válidos en disco.
 * Retorna objetos EmailRecord.
 *
 * @param {import('../email-reader').ParsedEmail[]} emails
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<EmailRecord[]>}
 */
async function downloadAttachments(emails, options = {}) {
  const incomingDir = path.resolve(config.dataDir, 'incoming');
  await ensureDir(incomingDir);

  const emailRecords = [];
  const maxSizeBytes = config.maxAttachmentSizeMb * 1024 * 1024;

  for (const email of emails) {
    const documentRecords = [];

    for (const att of (email.attachments || [])) {
      const docId = uuidv4();
      const startTime = Date.now();

      try {
        const declaredMime = normalizeMime(att.contentType);
        const inferredMime = extensionToMime(att.filename);
        const effectiveMime = (declaredMime === 'application/octet-stream' && inferredMime ? inferredMime : declaredMime);

        if (!isAllowedMime(effectiveMime, config.allowedMimeTypes)) {
          logger.warn(`MIME no permitido: ${effectiveMime}`, { docId, filename: att.filename });
          continue;
        }

        const sizeBytes = att.content?.length || 0;
        if (sizeBytes > maxSizeBytes || sizeBytes === 0) {
          logger.warn(`Tamaño inválido: ${sizeBytes} bytes`, { docId, filename: att.filename });
          continue;
        }

        const safeName = getSafeFilename(att.filename);
        const ext = path.extname(safeName) || mimeToExtension(effectiveMime);
        const diskFilename = `${docId}${ext}`;
        const filePath = path.join(incomingDir, diskFilename);

        if (!options.dryRun) {
          await fsp.writeFile(filePath, att.content);
        }

        // Crear DocumentRecord
        const docRecord = {
          id: docId,
          hash: null,
          status: 'pending',
          originalName: att.filename,
          mimeType: effectiveMime,
          sizeBytes,
          paths: {
            incoming: filePath,
            current: filePath,
            final: null,
            manifest: null,
          },
          classification: { category: null, confidence: 0, method: null },
          errors: [],
          metadata: {
            emailFrom: email.from,
            emailSubject: email.subject,
            emailDate: email.date,
          },
        };

        // Crear e inicializar Manifest
        if (!options.dryRun) {
          let manifest = createManifest({
            ...docRecord,
            emailMessageId: email.messageId,
            emailFrom: email.from,
            emailSubject: email.subject,
            emailDate: email.date,
          });
          addPipelineStep(manifest, 'download', 'ok', { filename: diskFilename }, startTime);
          docRecord.paths.manifest = await saveManifest(manifest, incomingDir);
        }

        documentRecords.push(docRecord);
      } catch (err) {
        logger.error(`Error en descarga de adjunto: ${att.filename}`, { error: err.message });
      }
    }

    if (documentRecords.length > 0) {
      emailRecords.push({
        uid: email.uid,
        messageId: email.messageId,
        from: email.from,
        subject: email.subject,
        date: email.date,
        bodyText: email.bodyText,
        documents: documentRecords,
      });
    }
  }

  return emailRecords;
}

module.exports = { downloadAttachments };
