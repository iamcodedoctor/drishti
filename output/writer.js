// DRISHTI v1 — File Writer
// Append-only writer. Reads output path from config at write time
// so custom --output dir works correctly.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import config from '../config.js';
import { info, error as logError } from '../core/logger.js';

/**
 * Get the current output file path (may change if --output was used).
 */
function getOutputFile() {
  return config.paths.rawResults;
}

/**
 * Write a single normalized result to the output file.
 * Format: [engine] keyword | position | domain | url
 */
export function writeResult(result) {
  const outputFile = getOutputFile();
  const line = `[${result.engine}] ${result.keyword} | ${result.position} | ${result.domain} | ${result.url}`;
  try {
    mkdirSync(dirname(outputFile), { recursive: true });
    appendFileSync(outputFile, line + '\n', 'utf-8');
  } catch (err) {
    logError(result.engine, `Failed to write result: ${err.message}`);
  }
}

/**
 * Write an array of normalized results.
 */
export function writeResults(results, engine) {
  if (results.length === 0) return;

  const outputFile = getOutputFile();
  const lines = results.map(
    (r) => `[${r.engine}] ${r.keyword} | ${r.position} | ${r.domain} | ${r.url}`
  );

  try {
    mkdirSync(dirname(outputFile), { recursive: true });
    appendFileSync(outputFile, lines.join('\n') + '\n', 'utf-8');
    info(engine, `Wrote ${results.length} results to ${outputFile}`);
  } catch (err) {
    logError(engine, `Failed to write results: ${err.message}`);
  }
}
