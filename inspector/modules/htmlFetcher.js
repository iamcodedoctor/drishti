// INSPECTOR-GENERAL v1 — HTML Fetcher
// Fetches raw HTML for parsing. Uses native fetch.

import { info, error as logError } from '../core/logger.js';
import inspectorConfig from '../config.js';

/**
 * Fetch HTML content of a URL.
 * @param {string} url
 * @param {string} domain
 * @returns {Promise<{ html: string, statusCode: number, headers: object } | null>}
 */
export async function fetchHTML(url, domain) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), inspectorConfig.fetchTimeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    const html = await response.text();
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    info(domain, `HTML fetched: ${html.length} chars | status=${response.status}`);

    return {
      html,
      statusCode: response.status,
      headers,
      finalUrl: response.url,
    };
  } catch (err) {
    logError(domain, `HTML fetch failed: ${err.message}`);
    return null;
  }
}
