// DRISHTI v1 — Result Normalizer
// Converts raw extracted results into a uniform schema.

/**
 * Extract domain from a URL.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Normalize a single raw result into the standard schema.
 * @param {object} raw - Raw extracted result
 * @param {string} engine - Engine name
 * @param {string} keyword - Search query
 * @returns {{ engine: string, keyword: string, domain: string, url: string, title: string, position: number }}
 */
export function normalizeResult(raw, engine, keyword) {
  return {
    engine,
    keyword: keyword.trim(),
    domain: extractDomain(raw.url),
    url: raw.url,
    title: raw.title,
    position: raw.position,
  };
}

/**
 * Normalize an array of raw results.
 * @param {Array} rawResults
 * @param {string} engine
 * @param {string} keyword
 * @returns {Array}
 */
export function normalizeAll(rawResults, engine, keyword) {
  return rawResults.map((r) => normalizeResult(r, engine, keyword));
}
