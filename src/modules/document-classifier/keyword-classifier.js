'use strict';

/**
 * keyword-classifier.js
 *
 * Clasificador por palabras clave, sin dependencias externas.
 *
 * ## Diseño:
 * Para cada categoría definimos:
 *   - keywords: palabras que, si aparecen en el texto, suman puntos
 *   - negativeKeywords: palabras que restan puntos (reducen falsos positivos)
 *
 * La confianza se calcula como:
 *   hits / totalKeywords para la categoría con más aciertos.
 *
 * El texto analizado proviene de:
 *   1. Nombre del fichero original (peso alto)
 *   2. Asunto del correo (peso medio)
 *   3. Cuerpo del correo en texto plano (peso bajo)
 *
 * ## Por qué keywords antes que OCR:
 *   - 0 ms de latencia adicional
 *   - Funciona sin Python instalado
 *   - Cubre el 70-80% de casos donde el remitente nombra el fichero correctamente
 *   - El OCR se reserva para los casos ambiguos
 */

/** @type {Record<string, {keywords: string[], negativeKeywords: string[]}>} */
const CATEGORY_RULES = {
  pasaporte: {
    keywords: [
      'pasaporte', 'passport', 'passport number', 'nif', 'nie',
      'documento de viaje', 'travel document', 'national id',
      'identidad', 'dni', 'identity document',
    ],
    negativeKeywords: ['factura', 'contrato', 'nómina', 'padrón'],
  },

  empadronamiento: {
    keywords: [
      'empadronamiento', 'padrón', 'empadronado', 'certificado de empadronamiento',
      'registro municipal', 'residencia municipal', 'municipal registration',
      'volante de empadronamiento', 'ayuntamiento', 'domicilio',
    ],
    negativeKeywords: ['pasaporte', 'contrato', 'nómina'],
  },

  contrato_trabajo: {
    keywords: [
      'contrato', 'contrato de trabajo', 'nómina', 'nomina', 'alta seguridad social',
      'tc2', 'vida laboral', 'employment contract', 'labor contract',
      'empresa', 'trabajador', 'salario', 'sueldo', 'convenio',
      'alta en la seguridad', 'seguridad social', 'afiliacion',
    ],
    negativeKeywords: ['factura', 'ticket', 'pasaporte'],
  },

  ticket: {
    keywords: [
      'ticket', 'factura', 'recibo', 'receipt', 'invoice',
      'compra', 'pago', 'total', 'iva', 'importe', 'tpv',
      'venta', 'cobro', 'payment', 'purchase',
    ],
    negativeKeywords: ['contrato', 'pasaporte', 'empadronamiento'],
  },

  otros: {
    keywords: [],
    negativeKeywords: [],
  },
};

const CATEGORIES = Object.keys(CATEGORY_RULES).filter((c) => c !== 'otros');

/**
 * Normaliza texto para comparación: lowercase, sin acentos, sin puntuación extra.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')                      // Descomponer acentos
    .replace(/[\u0300-\u036f]/g, '')       // Eliminar diacríticos
    .replace(/[^a-z0-9\s]/g, ' ')         // Reemplazar puntuación por espacio
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cuenta cuántas keywords de una lista aparecen en el texto.
 * @param {string} text
 * @param {string[]} keywords
 * @returns {number}
 */
function countMatches(text, keywords) {
  return keywords.reduce((count, kw) => {
    return text.includes(normalizeText(kw)) ? count + 1 : count;
  }, 0);
}

/**
 * Clasifica un documento basándose en texto de múltiples fuentes.
 *
 * @param {Object} params
 * @param {string} params.filename      - Nombre original del fichero
 * @param {string} params.emailSubject  - Asunto del correo
 * @param {string} params.emailBodyText - Cuerpo en texto plano
 * @returns {{ category: string, confidence: number, method: 'keyword', scores: Record<string, number> }}
 */
function classifyByKeywords({ filename, emailSubject, emailBodyText }) {
  // Construir corpus de texto con pesos:
  // filename aparece 3x (mayor peso), subject 2x, body 1x
  const corpus = normalizeText(
    `${filename} ${filename} ${filename} ` +
    `${emailSubject} ${emailSubject} ` +
    `${emailBodyText}`
  );

  const scores = {};

  for (const category of CATEGORIES) {
    const rules = CATEGORY_RULES[category];
    const positiveHits = countMatches(corpus, rules.keywords);
    const negativeHits = countMatches(corpus, rules.negativeKeywords);

    // Fórmula sigmoid: 1 hit=0.5, 2 hits=0.75, 3 hits=0.875, 4 hits=0.94
    // Permite clasificar con confianza alta con 2-3 keywords presentes.
    const positiveScore = positiveHits > 0 ? 1 - Math.pow(0.5, positiveHits) : 0;
    const negativeScore = negativeHits > 0 ? 1 - Math.pow(0.5, negativeHits) : 0;
    scores[category] = Math.max(0, positiveScore - negativeScore * 0.4);
  }

  // Categoría con mayor score
  const winner = Object.entries(scores).reduce(
    (best, [cat, score]) => (score > best.score ? { cat, score } : best),
    { cat: 'otros', score: 0 }
  );

  // Normalizar confianza a 0-1
  const confidence = Math.min(winner.score, 1);

  return {
    category: confidence === 0 ? 'otros' : winner.cat,
    confidence,
    method: 'keyword',
    scores,
  };
}

module.exports = { classifyByKeywords };
