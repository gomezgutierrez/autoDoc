'use strict';

const { BaseOcrProvider } = require('./base-provider');
const logger = require('../logger').child('ocr:paddleocr');

/**
 * ocr-provider/paddleocr.js
 *
 * Implementación STUB para PaddleOCR.
 *
 * ## Estado: preparada para Fase 2
 * PaddleOCR ofrece mayor precisión que Tesseract, especialmente con:
 *   - Documentos con layouts complejos (tablas, múltiples columnas)
 *   - Texto con fuentes inusuales o deformado
 *   - Documentos escaneados en baja calidad
 *
 * ## Para activar en Fase 2:
 *   1. Instalar: pip install paddlepaddle paddleocr
 *   2. Crear python/paddleocr_classifier.py con la misma interfaz JSON
 *   3. Implementar el método extractText() aquí usando subprocess
 *   4. Cambiar en .env: OCR_PROVIDER=paddleocr
 *
 * ## Interfaz de salida (mismo contrato que TesseractProvider):
 * { success, text, textSnippet, engine, error, durationMs }
 */

class PaddleOcrProvider extends BaseOcrProvider {
  constructor() {
    super('paddleocr');
  }

  /**
   * @param {string} filePath
   * @returns {Promise<import('./base-provider').OcrResult>}
   */
  async extractText(filePath) {
    // TODO (Fase 2): Implementar invocación de script Python con PaddleOCR
    logger.warn('PaddleOCR provider no implementado todavía. Usando stub.', {
      file: filePath,
    });

    return {
      success: false,
      text: '',
      textSnippet: '',
      engine: this.name,
      error: 'PaddleOCR provider no implementado (stub). Configura OCR_PROVIDER=tesseract.',
      durationMs: 0,
    };
  }
}

module.exports = { PaddleOcrProvider };
