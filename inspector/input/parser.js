// INSPECTOR-GENERAL v1 — Input Parser
// Reads cleaned_results.txt and extracts unique domains.

import { readFileSync } from 'node:fs';

/**
 * Parse cleaned results file and extract unique domains with their URLs.
 * @param {string} filePath - Path to cleaned_results.txt
 * @returns {Array<{ domain: string, url: string }>} Unique domain entries
 */
export function parseDomains(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());

  const domainMap = new Map(); // domain → first URL seen

  for (const line of lines) {
    const match = line.match(/^\[(\w+)\]\s+(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
    if (!match) continue;

    const domain = match[4].trim().toLowerCase();
    const url = match[5].trim();

    // Keep the first (highest-ranked) URL per domain
    if (!domainMap.has(domain)) {
      domainMap.set(domain, url);
    }
  }

  const domains = [];
  for (const [domain, url] of domainMap) {
    // Normalize URL — ensure https
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    domains.push({ domain, url: normalizedUrl });
  }

  return domains;
}
