// Rules for cleaned SERP rows: root URL only (no article paths), one row per host (last wins).

/**
 * True if URL has no path beyond origin (only `/` or empty path). Query/hash allowed on "homepage".
 * Filters article/blog paths like https://www.msn.com/en-in/news/...
 */
export function isRootOnlyUrl(url) {
  try {
    const u = new URL(url);
    const p = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return p === '/';
  } catch {
    return false;
  }
}

/**
 * Hostname key for deduping www vs bare.
 */
export function domainKeyFromUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (!h) return '';
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return '';
  }
}

export function filterRootUrlsOnly(rows) {
  return rows.filter((r) => isRootOnlyUrl(r.url));
}

export function normalizeUrlDedupeKey(url) {
  return url
    .trim()
    .replace(/\/+$/, '')
    .split('?')[0]
    .split('#')[0]
    .toLowerCase();
}

export function dedupeByNormalizedUrl(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = normalizeUrlDedupeKey(r.url);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

/**
 * Among rows in order, keep a single row per domainKeyFromUrl — the last occurrence wins.
 */
export function keepLastPerDomain(rows) {
  const lastIdx = new Map();
  rows.forEach((r, i) => {
    const k = domainKeyFromUrl(r.url);
    if (k) lastIdx.set(k, i);
  });
  return rows.filter((r, i) => {
    const k = domainKeyFromUrl(r.url);
    return k && lastIdx.get(k) === i;
  });
}

/**
 * Root-only filter → URL dedupe → one row per domain (last wins).
 * @param {Array<{ engine: string, keyword: string, position: number, domain: string, url: string }>} rows
 */
export function finalizeCleanedRows(rows) {
  const rootOnly = filterRootUrlsOnly(rows);
  const urlDeduped = dedupeByNormalizedUrl(rootOnly);
  const domainDeduped = keepLastPerDomain(urlDeduped);
  return {
    final: domainDeduped,
    pathDropped: rows.length - rootOnly.length,
    urlDropped: rootOnly.length - urlDeduped.length,
    domainDropped: urlDeduped.length - domainDeduped.length,
  };
}

export function renumberByKeywordEngine(rows) {
  const byGroup = {};
  for (const r of rows) {
    const key = `${r.engine}:${r.keyword}`;
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(r);
  }
  const final = [];
  for (const results of Object.values(byGroup)) {
    results.forEach((r, i) => {
      r.position = i + 1;
      final.push(r);
    });
  }
  return final;
}
