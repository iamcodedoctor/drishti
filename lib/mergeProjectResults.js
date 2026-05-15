// Merge tmp_* SERP outputs into canonical project files (add new URLs only).

import { readFileSync, writeFileSync, appendFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeCleanedRows, renumberByKeywordEngine } from '../parser/cleanedPolicy.js';

function normalizeUrlKey(url) {
  try {
    return url
      .trim()
      .replace(/\/+$/, '')
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function parseLine(line) {
  const match = line.match(/^\[(\w+)\]\s+(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
  if (!match) return null;
  return {
    engine: match[1],
    keyword: match[2].trim(),
    position: parseInt(match[3], 10),
    domain: match[4].trim(),
    url: match[5].trim(),
    rawLine: line.trim(),
  };
}

function readNonEmptyLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Add lines from tmp_raw whose URL is not already present in raw_results.txt.
 * @param {string} projectRoot absolute path to data/<project>
 */
export function mergeTmpRawIntoCanonical(projectRoot) {
  const canonical = join(projectRoot, 'raw_results.txt');
  const tmp = join(projectRoot, 'tmp_raw_results.txt');
  if (!existsSync(tmp)) return { added: 0, skipped: true };

  const byUrl = new Map();
  for (const line of readNonEmptyLines(canonical)) {
    const p = parseLine(line);
    if (p) byUrl.set(normalizeUrlKey(p.url), line);
  }

  let added = 0;
  for (const line of readNonEmptyLines(tmp)) {
    const p = parseLine(line);
    if (!p) continue;
    const key = normalizeUrlKey(p.url);
    if (!byUrl.has(key)) {
      byUrl.set(key, line);
      added++;
    }
  }

  const out = [...byUrl.values()].join('\n') + (byUrl.size ? '\n' : '');
  writeFileSync(canonical, out, 'utf-8');
  unlinkSync(tmp);
  return { added, skipped: false };
}

/**
 * Merge tmp_cleaned into cleaned_results.txt: concatenate canonical + tmp,
 * then apply same root-URL + domain (last wins) policy as parser/cleaner.js.
 */
export function mergeTmpCleanedIntoCanonical(projectRoot) {
  const canonical = join(projectRoot, 'cleaned_results.txt');
  const tmp = join(projectRoot, 'tmp_cleaned_results.txt');
  if (!existsSync(tmp)) return { added: 0, skipped: true };

  const combined = [...readNonEmptyLines(canonical), ...readNonEmptyLines(tmp)];
  const parsed = [];
  for (const line of combined) {
    const p = parseLine(line);
    if (p) parsed.push(p);
  }

  const stats = finalizeCleanedRows(parsed);
  const final = renumberByKeywordEngine(stats.final);
  const outputLines = final.map(
    (r) => `[${r.engine}] ${r.keyword} | ${r.position} | ${r.domain} | ${r.url}`,
  );

  writeFileSync(canonical, outputLines.join('\n') + (outputLines.length ? '\n' : ''), 'utf-8');
  
  // Also write domains.csv
  const domains = [...new Set(final.map(r => r.domain))];
  const csvLines = ['Domain', ...domains];
  writeFileSync(join(projectRoot, 'domains.csv'), csvLines.join('\n') + (csvLines.length ? '\n' : ''), 'utf-8');
  
  unlinkSync(tmp);
  return { rows: stats.final.length, skipped: false };
}

/**
 * Append tmp_logs.txt to logs.txt and remove tmp.
 */
export function mergeTmpLogs(projectRoot) {
  const canonical = join(projectRoot, 'logs.txt');
  const tmp = join(projectRoot, 'tmp_logs.txt');
  if (!existsSync(tmp)) return;

  const chunk = readFileSync(tmp, 'utf-8');
  if (chunk.trim()) {
    const banner = `\n--- tmp run ${new Date().toISOString()} ---\n`;
    appendFileSync(canonical, banner + chunk + (chunk.endsWith('\n') ? '' : '\n'), 'utf-8');
  }
  unlinkSync(tmp);
}
