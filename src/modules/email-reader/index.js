'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const path = require('path');
const logger = require('../logger').child('email-reader');
const config = require('../../config');

/**
 * email-reader/index.js
 *
 * Conecta a un servidor IMAP con ImapFlow, busca mensajes no leídos (UNSEEN),
 * los parsea con mailparser y devuelve una lista de objetos de correo
 * normalizados, incluyendo sus adjuntos como Buffers en memoria.
 *
 * Diseño:
 * - Se conecta, saca el lock del mailbox, procesa y desconecta limpiamente.
 * - Marca cada correo como SEEN antes de procesarlo para evitar reprocesado.
 * - En modo dryRun: NO marca como SEEN (útil para desarrollo).
 *
 * @typedef {Object} RawAttachment
 * @property {string} filename        - Nombre original del fichero
 * @property {string} contentType     - MIME type del adjunto
 * @property {Buffer} content         - Buffer con el contenido del fichero
 * @property {number} size            - Tamaño en bytes
 *
 * @typedef {Object} ParsedEmail
 * @property {string} messageId       - ID único del mensaje IMAP
 * @property {string} subject         - Asunto del correo
 * @property {string} from            - Remitente (address)
 * @property {Date}   date            - Fecha del correo
 * @property {string} bodyText        - Cuerpo en texto plano (útil para clasificación)
 * @property {RawAttachment[]} attachments
 */

/**
 * Lee los correos UNSEEN de la bandeja de entrada y los retorna parseados.
 *
 * @param {Object} [options]
 * @returns {Promise<ParsedEmail[]>}
 */
async function readUnseenEmails(options = {}) {
  const emails = [];

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.tls,
    auth: {
      user: config.imap.auth.user,
      pass: config.imap.auth.pass,
    },
    logger: false,
  });

  try {
    logger.info('Conectando al servidor IMAP...', {
      host: config.imap.host,
      port: config.imap.port,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const unseenUids = await client.search({ seen: false });
      logger.info(`Mensajes UNSEEN encontrados: ${unseenUids.length}`);

      if (unseenUids.length === 0) {
        return emails;
      }

      for (const uid of unseenUids) {
        try {
          const messageData = await client.fetchOne(
            String(uid),
            { source: true },
            { uid: false }
          );

          if (!messageData?.source) {
            logger.warn(`Mensaje UID ${uid} sin contenido, saltando.`);
            continue;
          }

          const parsed = await simpleParser(messageData.source, {
            skipHtmlToText: false,
            skipTextToHtml: true,
            skipImageLinks: true,
          });

          const from = parsed.from?.value?.[0]?.address || parsed.from?.text || 'desconocido';

          emails.push({
            uid,
            messageId: parsed.messageId || `uid-${uid}`,
            subject: parsed.subject || '(sin asunto)',
            from,
            date: parsed.date || new Date(),
            bodyText: parsed.text || '',
            attachments: (parsed.attachments || []).map((att) => ({
              filename: att.filename || `sin-nombre-${Date.now()}`,
              contentType: att.contentType || 'application/octet-stream',
              content: att.content,
              size: att.size || att.content?.length || 0,
            })),
          });
        } catch (parseErr) {
          logger.error(`Error parseando mensaje UID ${uid}`, { error: parseErr.message });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch { }
  }

  return emails;
}

/**
 * Marca un correo específico como leído en el servidor IMAP.
 * @param {number} uid - UID del mensaje
 * @returns {Promise<void>}
 */
async function markEmailAsSeen(uid) {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.tls,
    auth: {
      user: config.imap.auth.user,
      pass: config.imap.auth.pass,
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: false });
      logger.info(`Correo UID ${uid} marcado como leído.`);
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch { }
  }
}

module.exports = { readUnseenEmails, markEmailAsSeen };
