'use strict';

const { TesseractProvider } = require('./tesseract');
const { PaddleOcrProvider } = require('./paddleocr');
const logger = require('../logger').child('ocr-provider');
const config = require('../../config');

/**
 * ocr-provider/index.js — Factory de proveedores OCR.
 *
 * El provider activo se configura en .env con OCR_PROVIDER.
 * Valores posibles: 'tesseract' (default), 'paddleocr'
 *
 * ## Añadir un nuevo motor en el futuro:
 *   1. Crear `src/modules/ocr-provider/mi-motor.js` extendiendo BaseOcrProvider
 *   2. Importarlo aquí y añadirlo al mapa PROVIDERS
 *   3. Cambiar OCR_PROVIDER=mi-motor en .env — sin tocar nada más
 */

const PROVIDERS = {
  tesseract: () => new TesseractProvider(),
  paddleocr: () => new PaddleOcrProvider(),
};

/** Singleton: creado una vez por proceso */
let _activeProvider = null;

/**
 * Retorna el provider OCR activo (singleton).
 * @returns {import('./base-provider').BaseOcrProvider}
 */
function getOcrProvider() {
  if (_activeProvider) return _activeProvider;

  const key = (config.ocrProvider || 'tesseract').toLowerCase();
  const factory = PROVIDERS[key];

  if (!factory) {
    logger.warn(`OCR_PROVIDER "${key}" no reconocido. Usando tesseract por defecto.`);
    _activeProvider = new TesseractProvider();
  } else {
    _activeProvider = factory();
    logger.info(`OCR provider activo: ${_activeProvider.name}`);
  }

  return _activeProvider;
}

module.exports = { getOcrProvider };
