'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { BaseOcrProvider } = require('./base-provider');
const logger = require('../logger').child('ocr:tesseract');
const config = require('../../config');

/**
 * ocr-provider/tesseract.js
 *
 * Implementación OCR usando Tesseract a través del script Python classifier.py.
 *
 * ## Por qué invocar Python en lugar de tesseract.js nativo:
 *   - tesseract.js (JS puro) es significativamente menos preciso que el
 *     binding nativo de Python, especialmente con documentos en español.
 *   - pytesseract + pdf2image (Poppler) maneja PDFs multi-página correctamente.
 *   - Mantener un solo script Python facilita el intercambio futuro por PaddleOCR.
 */

const TIMEOUT_MS = 60_000;

class TesseractProvider extends BaseOcrProvider {
  constructor() {
    super('tesseract');
  }

  /**
   * @param {string} filePath
   * @returns {Promise<import('./base-provider').OcrResult>}
   */
  async extractText(filePath) {
    const startTime = Date.now();
    const scriptPath = path.resolve(
      __dirname, '../../../../python/classifier.py'
    );

    return new Promise((resolve) => {
      const child = spawn(
        config.pythonPath,
        [scriptPath, '--file', filePath, '--format', 'json'],
        {
          env: {
            ...process.env,
            TESSERACT_CMD: config.tesseractPath,
            PYTHONIOENCODING: 'utf-8',
          },
        }
      );

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        logger.warn('Timeout en Tesseract OCR', { file: path.basename(filePath) });
      }, TIMEOUT_MS);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (stderr.trim()) {
          logger.warn('Tesseract stderr', { stderr: stderr.trim().slice(0, 300) });
        }

        if (timedOut || code !== 0) {
          resolve({
            ...this.errorResult(`Proceso Python finalizado con código ${code}${timedOut ? ' (timeout)' : ''}`),
            durationMs,
          });
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          const text = parsed.text_snippet || '';
          resolve({
            success: true,
            text,
            textSnippet: text.slice(0, 500),
            engine: this.name,
            error: parsed.error || null,
            durationMs,
          });
        } catch (e) {
          resolve({
            ...this.errorResult(`JSON inválido de Python: ${e.message}`),
            durationMs,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          ...this.errorResult(`Error arrancando Python: ${err.message}`),
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}

module.exports = { TesseractProvider };
