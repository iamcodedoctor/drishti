// INSPECTOR-GENERAL v1 — Input Parser
// Reads cleaned_results.txt and extracts unique domains.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Parse cleaned results file and extract unique domains with their URLs.
 * @param {string} filePath - Path to cleaned_results.txt
 * @returns {Array<{ domain: string, url: string }>} Unique domain entries
 */
export function parseDomains(filePath) {
  function normalizeDomain(d) {
    const x = String(d || '').trim().toLowerCase();
    return x.startsWith('www.') ? x.slice(4) : x;
  }

  // Base: domain -> first URL seen.
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const domainMap = new Map(); // domain → first URL seen

  for (const line of lines) {
    const match = line.match(/^\[(\w+)\]\s+(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
    if (!match) continue;
    const domain = match[4].trim().toLowerCase();
    const url = match[5].trim();
    if (!domainMap.has(domain)) domainMap.set(domain, url);
  }

  const baseDomains = [];
  for (const [domain, url] of domainMap) {
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http')) normalizedUrl = `https://${normalizedUrl}`;
    baseDomains.push({ domain, url: normalizedUrl });
  }

  const projectRoot = dirname(filePath);

  const useAiClassification = process.env.DRISHTI_INSPECTOR_USE_AI_CLASSIFICATION === '1';
  if (useAiClassification) {
    const aiPath = join(projectRoot, 'ai_qualification.txt');
    if (existsSync(aiPath)) {
      const raw = readFileSync(aiPath, 'utf-8');
      const lines = raw.split('\n');
      const allow = new Set();
      const linkRe = /^\[(.+?)\]\((.+?)\)\s*$/;

      function findNextNonEmpty(fromIdx) {
        for (let j = fromIdx; j < lines.length; j++) {
          if (lines[j]?.trim()) return j;
        }
        return -1;
      }

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]?.match(linkRe);
        if (!m) continue;
        const nextIdx = findNextNonEmpty(i + 1);
        if (nextIdx === -1) break;
        try {
          const rec = JSON.parse(lines[nextIdx].trim());
          const status = String(rec?.status || '').trim();
          if (status === 'high_value' || status === 'medium_value') {
            allow.add(normalizeDomain(rec?.domain || m[1]));
          }
        } catch {
          /* skip malformed */
        }
      }

      return baseDomains.filter((d) => allow.has(normalizeDomain(d.domain)));
    }
  }

  // Optional prefilter consumption (quality triage).
  const usePrefilter = process.env.DRISHTI_INSPECTOR_USE_PREFILTER === '1';
  if (!usePrefilter) return baseDomains;

  const minPreScoreRaw = process.env.DRISHTI_INSPECTOR_MIN_PRESCORE ?? '35';
  const minPreScore = Number(minPreScoreRaw);
  const prefilterPath = join(projectRoot, 'prefilter.txt');

  if (!existsSync(prefilterPath)) return baseDomains;

  // prefilter.txt format:
  //   [domain](https://domain)
  //   {"domain":"...","pre_score":...,...}
  const preRaw = readFileSync(prefilterPath, 'utf-8');
  const preLines = preRaw.split('\n');

  const allow = new Set();
  const linkRe = /^\[(.+?)\]\((.+?)\)\s*$/;
  function findNextNonEmpty(fromIdx) {
    for (let j = fromIdx; j < preLines.length; j++) {
      if (preLines[j]?.trim()) return j;
    }
    return -1;
  }

  for (let i = 0; i < preLines.length; i++) {
    const m = preLines[i]?.match(linkRe);
    if (!m) continue;
    const name = String(m[1] || '').trim().toLowerCase();
    const nextIdx = findNextNonEmpty(i + 1);
    if (nextIdx === -1) break;
    const jsonLine = preLines[nextIdx].trim();
    let rec;
    try {
      rec = JSON.parse(jsonLine);
    } catch {
      continue;
    }
    const recDomain = normalizeDomain(rec?.domain || name);
    const ps = Number(rec?.pre_score);
    if (Number.isFinite(ps) && ps >= minPreScore) allow.add(recDomain);
  }

  const filtered = baseDomains.filter((d) => allow.has(normalizeDomain(d.domain)));
  return filtered;
}
