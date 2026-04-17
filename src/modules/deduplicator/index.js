'use strict';

const path = require('path');
const fsp = require('fs/promises');
const fs = require('fs');
const logger = require('../logger').child('deduplicator');
const config = require('../../config');
const { ensureDir } = require('../../utils/file-utils');
const { sha256OfFile } = require('../../utils/hash-utils');

/**
 * deduplicator/index.js
 *
 * Detecta adjuntos duplicados mediante SHA-256 antes de procesar.
 *
 * ## Funcionamiento:
 * Mantiene un registro persistente en `data/hash-registry.json`:
 * {
 *   "{sha256}": {
 *     "firstSeenAt": "ISO date",
 *     "originalName": "pasaporte.jpg",
 *     "finalPath": "data/processed/pasaporte/...",
 *     "emailMessageId": "<msg-id>"
 *   }
 * }
 *
 * Al recibir un nuevo documento:
 *   1. Calcula el SHA-256 completo del fichero.
 *   2. Busca el hash en el registro.
 *   3a. Si NO existe: registra y devuelve { isDuplicate: false }.
 *   3b. Si existe: mueve el fichero a data/duplicates/ y devuelve { isDuplicate: true }.
 *
 * ## Persistencia:
 * El registro se recarga en cada arranque (tolerante a reinicios).
 * Solo se registran documentos que completaron el pipeline exitosamente
 * (la actualización del registro la llama el manifest al finalizar).
 *
 * @typedef {Object} DuplicateCheckResult
 * @property {boolean} isDuplicate
 * @property {string}  hash            - SHA-256 completo
 * @property {string|null} firstSeenAt - Solo si isDuplicate=true
 * @property {string|null} duplicatePath - Ruta donde se guardó el duplicado
 */

const REGISTRY_FILE = 'hash-registry.json';

/**
 * Retorna la ruta al fichero de registro de hashes.
 * @returns {string}
 */
function getRegistryPath() {
  return path.resolve(config.dataDir, REGISTRY_FILE);
}

/**
 * Carga el registro de hashes desde disco.
 * @returns {Promise<Record<string, Object>>}
 */
async function loadRegistry() {
  const registryPath = getRegistryPath();
  try {
    const raw = await fsp.readFile(registryPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // Si no existe o es JSON inválido, empezar con registro vacío
    return {};
  }
}

/**
 * Persiste el registro de hashes a disco (escritura atómica).
 * @param {Record<string, Object>} registry
 * @returns {Promise<void>}
 */
async function saveRegistry(registry) {
  const registryPath = getRegistryPath();
  const tmpPath = registryPath + '.tmp';
  await fsp.writeFile(tmpPath, JSON.stringify(registry, null, 2), 'utf-8');
  await fsp.rename(tmpPath, registryPath);
}

/**
 * Registra un documento como procesado exitosamente.
 * Llamar solo cuando el pipeline ha completado sin errores.
 *
 * @param {string} hash          - SHA-256 completo
 * @param {Object} metadata      - Campos a registrar
 * @returns {Promise<void>}
 */
async function registerHash(hash, metadata) {
  const registry = await loadRegistry();
  if (!registry[hash]) {
    registry[hash] = {
      firstSeenAt: new Date().toISOString(),
      ...metadata,
    };
    await saveRegistry(registry);
    logger.info(`Hash registrado: ${hash.slice(0, 8)}...`, metadata);
  }
}

/**
 * Verifica si un fichero es duplicado y lo gestiona.
 *
 * @param {string} filePath        - Ruta al fichero a comprobar
 * @param {Object} context         - Contexto para logging/registro
 * @param {boolean} [dryRun=false]
 * @returns {Promise<DuplicateCheckResult>}
 */
async function checkDuplicate(filePath, context = {}, dryRun = false) {
  const hash = await sha256OfFile(filePath, 64); // Hash completo para registro
  const shortHash = hash.slice(0, 8);

  const registry = await loadRegistry();

  if (registry[hash]) {
    logger.warn(`Duplicado detectado: ${path.basename(filePath)} (${shortHash}...)`, {
      ...context,
      firstSeenAt: registry[hash].firstSeenAt,
      originalName: registry[hash].originalName,
    });

    // Mover a carpeta de duplicados
    const dupDir = path.resolve(config.dataDir, 'duplicates');
    await ensureDir(dupDir);

    const dupFilename = `${shortHash}_${path.basename(filePath)}`;
    const dupPath = path.join(dupDir, dupFilename);

    if (!dryRun) {
      try {
        await fsp.rename(filePath, dupPath);
      } catch {
        // Si falla el move (ej. cross-device), intentar copy+delete
        await fsp.copyFile(filePath, dupPath);
        await fsp.unlink(filePath).catch(() => {});
      }
    }

    return {
      isDuplicate: true,
      hash,
      firstSeenAt: registry[hash].firstSeenAt,
      duplicatePath: dryRun ? null : dupPath,
    };
  }

  return {
    isDuplicate: false,
    hash,
    firstSeenAt: null,
    duplicatePath: null,
  };
}

module.exports = { checkDuplicate, registerHash, loadRegistry };
