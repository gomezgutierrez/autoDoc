'use strict';

/**
 * ocr-provider/base-provider.js
 *
 * Interfaz abstracta para motores de OCR.
 *
 * ## Contrato:
 * Todo provider que implemente esta interfaz debe:
 *   1. Extender `BaseOcrProvider`.
 *   2. Implementar el método `extractText(filePath)`.
 *   3. Devolver un `OcrResult` con los campos definidos abajo.
 *
 * ## Cómo añadir un nuevo motor (ej. PaddleOCR, AWS Textract):
 *   1. Crear `src/modules/ocr-provider/paddleocr.js` extendiendo esta clase.
 *   2. Implementar `extractText()`.
 *   3. Registrar la clave en `ocr-provider/index.js`.
 *   4. Cambiar `OCR_PROVIDER=paddleocr` en `.env`.
 *
 * @typedef {Object} OcrResult
 * @property {boolean} success       - true si el OCR extrajo texto
 * @property {string}  text          - texto extraído (vacío si error)
 * @property {string}  textSnippet   - primeros 500 chars (para logs/manifest)
 * @property {string}  engine        - nombre del motor usado
 * @property {string|null} error     - mensaje de error si success=false
 * @property {number}  durationMs   - tiempo de procesamiento
 */

class BaseOcrProvider {
  /**
   * @param {string} name - Nombre identificativo del motor
   */
  constructor(name) {
    if (!name) throw new Error('OcrProvider requiere un nombre');
    this.name = name;
  }

  /**
   * Extrae texto de un fichero PDF o imagen.
   * Debe ser implementado por cada proveedor concreto.
   *
   * @param {string} filePath - Ruta absoluta al fichero
   * @returns {Promise<OcrResult>}
   */
  async extractText(filePath) { // eslint-disable-line no-unused-vars
    throw new Error(`[${this.name}] extractText() debe ser implementado por el provider concreto`);
  }

  /**
   * Construye un OcrResult de error estándar.
   * @param {string} errorMessage
   * @returns {OcrResult}
   */
  errorResult(errorMessage) {
    return {
      success: false,
      text: '',
      textSnippet: '',
      engine: this.name,
      error: errorMessage,
      durationMs: 0,
    };
  }
}

module.exports = { BaseOcrProvider };
