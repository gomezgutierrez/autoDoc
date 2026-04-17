'use strict';

const path = require('path');
const fsp = require('fs/promises');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const logger = require('../logger').child('pdf-converter');
const { normalizeMime } = require('../../utils/mime-utils');

/**
 * pdf-converter/index.js
 *
 * Convierte imágenes (JPG, PNG) a PDF con corrección automática de orientación.
 *
 * ## Por qué sharp para la orientación:
 * Las cámaras de móvil guardan las fotos en orientación física "landscape" pero
 * añaden en los metadatos EXIF el campo `Orientation` indicando cómo rotarlas
 * para mostrarlas verticales. La mayoría de visores aplican esta rotación
 * automáticamente, pero cuando construimos un PDF, debemos rotar los píxeles
 * físicamente (no solo el metadata) para que la imagen se vea correctamente
 * en todos los visores PDF.
 *
 * Sharp con `.rotate()` (sin argumentos) lee el campo EXIF Orientation y aplica
 * la rotación/flip necesario, luego elimina el tag para evitar doble rotación.
 *
 * ## Flujo por fichero:
 * 1. Si es PDF: add metadata normalizado y devolver como está.
 * 2. Si es imagen:
 *    a. sharp().rotate() → auto-corrección EXIF
 *    b. .resize({ width: A4_WIDTH_PX, fit: 'inside', withoutEnlargement: true })
 *    c. .jpeg({ quality: 85 }) → buffer normalizado
 *    d. pdf-lib: crear página A4, embed imagen centrada, guardar PDF
 */

// A4 a 150 DPI: 1240x1754 px (razonable para documentos legales sin ser enorme)
const A4_W_PX = 1240;
const A4_H_PX = 1754;
// Puntos PDF A4: 595 x 842 pt
const A4_W_PT = 595.28;
const A4_H_PT = 841.89;

const { addPipelineStep, saveManifest } = require('../document-manifest');

/**
 * Convierte imágenes a PDF y normaliza la orientación.
 *
 * @param {import('../attachment-downloader').DocumentRecord[]} documents
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<import('../attachment-downloader').DocumentRecord[]>}
 */
async function convertToPdf(documents, options = {}) {
  const results = [];

  for (const doc of documents) {
    if (doc.status !== 'processing' && doc.status !== 'pending') {
      results.push(doc);
      continue;
    }

    const startTime = Date.now();
    const mime = normalizeMime(doc.mimeType);
    const logCtx = { id: doc.id, filename: doc.originalName, mime };

    let manifest;
    try {
      if (doc.paths.manifest) {
        manifest = JSON.parse(await fsp.readFile(doc.paths.manifest, 'utf-8'));
      }
    } catch (e) {
      logger.error('Error cargando manifest en converter', { id: doc.id });
    }

    try {
      // ---- CASO 1: Ya es PDF ----
      if (mime === 'application/pdf') {
        if (manifest) {
          addPipelineStep(manifest, 'conversion', 'ok', { applied: false, reason: 'already_pdf' }, startTime);
          await saveManifest(manifest, path.dirname(doc.paths.manifest));
        }
        results.push(doc);
        continue;
      }

      // ---- CASO 2: Imagen (JPEG/PNG) → PDF ----
      if (['image/jpeg', 'image/png'].includes(mime)) {
        logger.info('Convirtiendo imagen a PDF...', logCtx);

        const imageBuffer = await fsp.readFile(doc.paths.current);
        const metaBefore = await sharp(imageBuffer).metadata();
        const needsRotation = metaBefore.orientation && metaBefore.orientation !== 1;

        const processedBuffer = await sharp(imageBuffer)
          .rotate()
          .resize({
            width: A4_W_PX,
            height: A4_H_PX,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();

        const pdfDoc = await PDFDocument.create();
        const embeddedImg = await pdfDoc.embedJpg(processedBuffer);
        const imgDims = embeddedImg.scaleToFit(A4_W_PT, A4_H_PT);
        const page = pdfDoc.addPage([A4_W_PT, A4_H_PT]);
        
        page.drawImage(embeddedImg, {
          x: (A4_W_PT - imgDims.width) / 2,
          y: (A4_H_PT - imgDims.height) / 2,
          width: imgDims.width,
          height: imgDims.height,
        });

        pdfDoc.setTitle(doc.originalName);
        pdfDoc.setProducer('AutoDoc');
        pdfDoc.setCreationDate(doc.metadata.emailDate || new Date());

        const pdfBytes = await pdfDoc.save();
        const pdfPath = doc.paths.current.replace(/\.(jpe?g|png)$/i, '.pdf');

        if (!options.dryRun) {
          await fsp.writeFile(pdfPath, pdfBytes);
          // Opcional: eliminar el JPG intermedio si ya se convirtió exitosamente
          if (doc.paths.current !== doc.paths.incoming) {
            await fsp.unlink(doc.paths.current).catch(() => {});
          }
        }

        doc.paths.current = pdfPath;
        doc.mimeType = 'application/pdf';

        if (manifest) {
          addPipelineStep(manifest, 'conversion', 'ok', { 
            applied: true, 
            orientationFixed: !!needsRotation,
            originalOrientation: metaBefore.orientation,
            destPath: pdfPath 
          }, startTime);
          await saveManifest(manifest, path.dirname(doc.paths.manifest));
        }

        results.push(doc);
        continue;
      }

      // ---- OTROS CASOS ----
      results.push(doc);
    } catch (err) {
      logger.error('Error en conversion', { ...logCtx, error: err.message });
      doc.status = 'error';
      doc.errors.push(`Conversion error: ${err.message}`);
      if (manifest) {
        manifest.status = 'error';
        addPipelineStep(manifest, 'conversion', 'error', { error: err.message }, startTime);
        await saveManifest(manifest, path.dirname(doc.paths.manifest));
      }
      results.push(doc);
    }
  }

  return results;
}

module.exports = { convertToPdf };
