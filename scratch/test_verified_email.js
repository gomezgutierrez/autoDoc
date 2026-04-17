'use strict';

require('dotenv').config();
const path = require('path');
const logger = require('../src/modules/logger');
const { readUnseenEmails, markEmailAsSeen } = require('../src/modules/email-reader');
const { downloadAttachments } = require('../src/modules/attachment-downloader');
const { normalizeDocuments } = require('../src/modules/document-normalizer');
const { convertToPdf } = require('../src/modules/pdf-converter');
const { classifyDocuments } = require('../src/modules/document-classifier');
const { renameDocuments } = require('../src/modules/file-renamer');
const { organizeDocuments } = require('../src/modules/expedient-organizer');
const { checkDuplicate } = require('../src/modules/deduplicator');
const { sendToManualReview } = require('../src/modules/manual-review-manager');

async function testSingleEmail() {
  const targetSubject = 'prueba documentacion';
  logger.info(`Iniciando prueba específica para el correo: "${targetSubject}"`);

  try {
    // 1. Leer solo el correo específico
    const allUnseen = await readUnseenEmails();
    const targetEmail = allUnseen.find(e => e.subject.toLowerCase().includes(targetSubject.toLowerCase()));

    if (!targetEmail) {
      logger.error(`No se encontró ningún correo UNSEEN con el asunto: "${targetSubject}"`);
      logger.info(`Total de correos pendientes detectados: ${allUnseen.length}`);
      return;
    }

    logger.info(`Correo detectado con UID: ${targetEmail.uid}. Procesando...`);
    let allDocsHandled = true;

    // 2. Descargar
    const [emailRecord] = await downloadAttachments([targetEmail]);
    
    // 3. Loop por documentos
    for (let doc of emailRecord.documents) {
      logger.info(`Procesando adjunto: ${doc.originalName}`);
      
      // A. Deduplicación (omitimos para el test si queremos forzar el procesado)
      const dupRes = await checkDuplicate(doc.paths.incoming, { docId: doc.id });
      doc.hash = dupRes.hash;

      // B. Normalizar
      [doc] = await normalizeDocuments([doc]);
      
      // C. Convertir
      [doc] = await convertToPdf([doc]);
      
      // D. Clasificar
      [doc] = await classifyDocuments([doc]);
      
      // E. Renombrar
      [doc] = await renameDocuments([doc]);

      // F. Organizar / Review
      if (doc.status === 'review') {
        logger.warn('Documento requiere revisión manual.');
        await sendToManualReview([doc]);
      } else {
        await organizeDocuments([doc]);
        logger.info(`✓ Documento organizado en: ${doc.paths.final}`);
      }
    }

    // 4. Marcar como leído (Desactivado temporalmente para pruebas)
    /*
    if (allDocsHandled) {
      await markEmailAsSeen(targetEmail.uid);
      logger.info('Email de prueba completado y marcado como leído.');
    } else {
      logger.warn('Email de prueba NO marcado como leído por fallos en el proceso.');
    }
    */
    logger.info(`[MODO PRUEBA] Correo UID ${targetEmail.uid} dejado como NO LEÍDO.`);

  } catch (err) {
    logger.error('Error en el test:', err);
  }
}

testSingleEmail();
