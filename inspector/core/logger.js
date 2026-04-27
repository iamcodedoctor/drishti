// INSPECTOR-GENERAL v1 — Logger
// Append-only logger for inspector operations.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import inspectorConfig from '../config.js';

function logFilePath() {
  return inspectorConfig.logFile;
}

function ts() {
  return new Date().toISOString();
}

export function log(level, context, message) {
  const line = `[${ts()}] [${level}] [INSPECTOR:${context}] ${message}`;
  console.log(line);
  try {
    const file = logFilePath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n', 'utf-8');
  } catch {}
}

export function info(ctx, msg) { log('INFO', ctx, msg); }
export function warn(ctx, msg) { log('WARN', ctx, msg); }
export function error(ctx, msg) { log('ERROR', ctx, msg); }
export function debug(ctx, msg) { log('DEBUG', ctx, msg); }
