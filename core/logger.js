// DRISHTI v1 — Logger Module
// Dual output: console + append-only log file.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import config from '../config.js';

function logFilePath() {
  return config.paths.logs;
}

/**
 * Get ISO timestamp string.
 */
function ts() {
  return new Date().toISOString();
}

/**
 * Write a log line to file and console.
 * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'} level
 * @param {string} engine
 * @param {string} message
 */
export function log(level, engine, message) {
  const line = `[${ts()}] [${level}] [${engine}] ${message}`;
  console.log(line);
  try {
    const file = logFilePath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n', 'utf-8');
  } catch (err) {
    console.error(`[LOGGER] Failed to write log: ${err.message}`);
  }
}

export function info(engine, msg) { log('INFO', engine, msg); }
export function warn(engine, msg) { log('WARN', engine, msg); }
export function error(engine, msg) { log('ERROR', engine, msg); }
export function debug(engine, msg) { log('DEBUG', engine, msg); }
