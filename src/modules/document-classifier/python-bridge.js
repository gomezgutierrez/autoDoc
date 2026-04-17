'use strict';

const { spawn } = require('child_process');
const path = require('path');
const logger = require('../logger').child('python-bridge');
const config = require('../../config');

/**
 * python-bridge.js
 *
 * Invoca el script Python de OCR como subproceso y devuelve el resultado JSON.
 *
 * ## Protocolo de comunicación:
 * - STDIN:  ruta absoluta al fichero PDF (string)
 * - STDOUT: JSON { category, confidence, text_snippet }
 * - STDERR: cualquier traza de error de Python (se loggea como warn)
 * - Exit 0: éxito; Exit != 0: error
 *
 * ## Timeout:
 * El subproceso tiene un timeout de 60s. Si supera ese tiempo,
 * se mata y el resultado se trata como confianza 0.
 *
 * ## Por qué subprocess en lugar de una API HTTP:
 * Mantiene Node.js como orquestador único sin necesidad de
 * levantar un servidor Python separado. Para mayor volumen,
 * esta interfaz puede evolucionar a un HTTP microservice sin
 * cambiar el contrato del caller.
 */

const PYTHON_TIMEOUT_MS = 60_000; // 60 segundos max por fichero

/**
 * Invoca classifier.py con la ruta del fichero y devuelve el resultado.
 *
 * @param {string} filePath - Ruta absoluta al PDF a clasificar
 * @returns {Promise<{ category: string, confidence: number, textSnippet: string }>}
 */
async function classifyWithPython(filePath) {
  return new Promise((resolve) => {
    // Usamos path.resolve para garantizar una ruta absoluta correcta basada en la raíz del proyecto
    const scriptPath = path.resolve(config.rootDir, 'python', 'classifier.py');

    logger.info('Invocando clasificador Python...', {
      file: path.basename(filePath),
      script: scriptPath,
      rootDir: config.rootDir
    });

    const child = spawn(config.pythonPath, [scriptPath, '--file', filePath, '--format', 'json'], {
      env: {
        ...process.env,
        TESSERACT_CMD: config.tesseractPath,
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Timeout de seguridad
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      logger.warn('Timeout en clasificador Python', { file: path.basename(filePath) });
    }, PYTHON_TIMEOUT_MS);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (stderr) {
        logger.warn('Python stderr', { stderr: stderr.trim().slice(0, 500) });
      }

      if (timedOut || code !== 0) {
        logger.error('Clasificador Python falló', {
          code,
          timedOut,
          file: path.basename(filePath),
        });
        resolve({ category: 'otros', confidence: 0, textSnippet: '' });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        logger.info('Resultado clasificador Python', {
          file: path.basename(filePath),
          category: result.category,
          confidence: result.confidence,
        });
        resolve({
          category: result.category || 'otros',
          confidence: typeof result.confidence === 'number' ? result.confidence : 0,
          textSnippet: result.text_snippet || '',
        });
      } catch (parseErr) {
        logger.error('Error parseando respuesta JSON de Python', {
          error: parseErr.message,
          rawOutput: stdout.slice(0, 200),
        });
        resolve({ category: 'otros', confidence: 0, textSnippet: '' });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.error('Error arrancando proceso Python', { error: err.message });
      resolve({ category: 'otros', confidence: 0, textSnippet: '' });
    });
  });
}

module.exports = { classifyWithPython };
