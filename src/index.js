'use strict';

/**
 * src/index.js — Orquestador principal del pipeline de AutoDoc.
 *
 * Este fichero une todos los módulos en un pipeline secuencial.
 * Puede ejecutarse de dos formas:
 *
 *   1. Modo daemon (por defecto):
 *      node src/index.js
 *      Ejecuta el pipeline según el cron configurado en CRON_SCHEDULE.
 *
 *   2. Modo dry-run:
 *      node src/index.js --dry-run
 *      Ejecuta UNA sola vez sin marcar correos como leídos ni
 *      escribir ficheros en disco (útil para desarrollo).
 *
 *   3. Modo single-pass:
 *      node src/index.js --single-pass
 *      Ejecuta UNA sola vez y termina (útil para CI / testing).
 *
 * ## Manejo de errores:
 * El pipeline captura errores a nivel de documento, no de proceso.
 * Un PDF corrupto no detiene el procesado de los demás adjuntos del mismo correo.
 * Solo los errores fatales (conexión IMAP imposible) detienen la ejecución.
 */

// Cargar variables de entorno ANTES que cualquier otro módulo
require('dotenv').config();

const cron = require('node-cron');
const pLimit = require('p-limit');
const path = require('path');

const config     = require('./config');
const logger     = require('./modules/logger');
const { readUnseenEmails, markEmailAsSeen }     = require('./modules/email-reader');
const { downloadAttachments }  = require('./modules/attachment-downloader');
const { normalizeDocuments }   = require('./modules/document-normalizer');
const { convertToPdf }         = require('./modules/pdf-converter');
const { classifyDocuments }    = require('./modules/document-classifier');
const { renameDocuments }      = require('./modules/file-renamer');
const { organizeDocuments }    = require('./modules/expedient-organizer');
const { sendToManualReview }   = require('./modules/manual-review-manager');
const { checkDuplicate }       = require('./modules/deduplicator');
const { ensureDir }            = require('./utils/file-utils');

// ---- Parseo de argumentos de línea de comando ----
const args = process.argv.slice(2);
const isDryRun     = args.includes('--dry-run');
const isSinglePass = args.includes('--single-pass');

/**
 * Ejecuta el pipeline completo de AutoDoc una vez.
 */
async function runPipeline(options = {}) {
  const runId = `run-${Date.now()}`;
  const startTime = Date.now();

  logger.info('═══════════════════════════════════════', { runId });
  logger.info('AutoDoc Pipeline — Inicio', { runId, dryRun: options.dryRun });

  const summary = {
    runId,
    dryRun: options.dryRun,
    startedAt: new Date().toISOString(),
    emailsRead: 0,
    emailsProcessed: 0,
    docsTotal: 0,
    docsDone: 0,
    docsReview: 0,
    docsDuplicate: 0,
    docsError: 0,
    errors: [],
    durationMs: 0,
  };

  try {
    // 1. Leer correos
    const emails = await readUnseenEmails();
    summary.emailsRead = emails.length;

    if (emails.length === 0) {
      logger.info('Sin correos nuevos.', { runId });
      summary.durationMs = Date.now() - startTime;
      return summary;
    }

    // 2. Descargar y crear registros (este paso agrupa por EmailRecord)
    const emailRecords = await downloadAttachments(emails, { dryRun: options.dryRun });

    // 3. Procesamiento transaccional por Email
    for (const email of emailRecords) {
      logger.info(`--- Procesando Email: "${email.subject}" ---`, { messageId: email.messageId });
      
      let allDocsHandled = true;

      for (let doc of email.documents) {
        summary.docsTotal++;
        const logCtx = { docId: doc.id, filename: doc.originalName };

        try {
          // A. Deduplicación
          const dupRes = await checkDuplicate(doc.paths.incoming, { docId: doc.id }, options.dryRun);
          if (dupRes.isDuplicate) {
            doc.status = 'duplicate';
            doc.hash = dupRes.hash;
            summary.docsDuplicate++;
            logger.info('Documento duplicado saltado.', logCtx);
            continue;
          }
          doc.hash = dupRes.hash;

          // B. Normalizar
          [doc] = await normalizeDocuments([doc], options);
          if (doc.status === 'error') { allDocsHandled = false; summary.docsError++; continue; }

          // C. Convertir PDF
          [doc] = await convertToPdf([doc], options);
          if (doc.status === 'error') { allDocsHandled = false; summary.docsError++; continue; }

          // D. Clasificar
          [doc] = await classifyDocuments([doc], options);
          if (doc.status === 'error') { allDocsHandled = false; summary.docsError++; continue; }

          // E. Renombrar
          [doc] = await renameDocuments([doc]);

          // F. Organizar o Enviar a Review
          if (doc.status === 'review') {
            [doc] = await sendToManualReview([doc], options);
            summary.docsReview++;
          } else {
            [doc] = await organizeDocuments([doc], options);
            if (doc.status === 'done') {
              summary.docsDone++;
            } else {
              allDocsHandled = false;
              summary.docsError++;
            }
          }
        } catch (docErr) {
          logger.error(`Error inesperado procesando documento ${doc.id}`, { error: docErr.message });
          allDocsHandled = false;
          summary.docsError++;
        }
      }

      // G. MARCAR COMO LEÍDO (Sólo si no hubo errores críticos en ningún adjunto)
      if (allDocsHandled && !options.dryRun) {
        try {
          await markEmailAsSeen(email.uid);
          summary.emailsProcessed++;
          logger.info(`Email marcado como leído: ${email.uid}`);
        } catch (markErr) {
          logger.error(`Error marcando email como leído UID ${email.uid}`, { error: markErr.message });
        }
      } else if (!allDocsHandled) {
        logger.warn(`Email NO marcado como leído por errores en adjuntos: ${email.uid}`);
      }
    }

  } catch (err) {
    logger.error('Error fatal', { error: err.message });
    summary.errors.push(err.message);
  }

  summary.durationMs = Date.now() - startTime;
  logger.info('AutoDoc Pipeline — Resumen', summary);
  return summary;
}

/**
 * Inicializa la estructura de directorios necesaria.
 */
async function bootstrap() {
  await ensureDir(path.resolve(config.dataDir, 'incoming'));
  await ensureDir(path.resolve(config.dataDir, 'review'));
  await ensureDir(path.resolve(config.dataDir, 'duplicates'));
  await ensureDir(path.resolve(config.logsDir));
}

/**
 * Punto de entrada principal.
 */
async function main() {
  try {
    logger.info('AutoDoc arrancando (v2 Architecture)...', {
      imap: config.imap.host,
      cron: isDryRun || isSinglePass ? 'off' : config.cronSchedule,
      ocr: config.pythonOcrEnabled,
    });

    await bootstrap();

    if (isDryRun) {
      await runPipeline({ dryRun: true });
      process.exit(0);
    }

    if (isSinglePass) {
      await runPipeline({ dryRun: false });
      process.exit(0);
    }

    cron.schedule(config.cronSchedule, async () => {
      await runPipeline({ dryRun: false });
    });

    // Primera ejecución
    await runPipeline({ dryRun: false });

  } catch (err) {
    logger.error('Error fatal startup', { error: err.message });
    process.exit(1);
  }
}

main();
