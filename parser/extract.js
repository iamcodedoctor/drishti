// DRISHTI v1 — Result Extractor
// Engine-specific DOM extraction logic.
// Handles mixed result containers (videos, AI panels, web results).

import config from '../config.js';
import { debug } from '../core/logger.js';

/**
 * Extract search results from the current page.
 * Handles Google's MjjYud containers (which wrap mixed content types),
 * Bing's li.b_algo, and DuckDuckGo's article elements.
 *
 * @param {import('playwright').Page} page
 * @param {string} engine - 'google' | 'bing' | 'duckduckgo'
 * @param {string} keyword - The search query
 * @returns {Promise<Array<{ title: string, url: string, snippet: string, position: number }>>}
 */
export async function extractResults(page, engine, keyword) {
  const cfg = config.engines[engine];
  const results = [];

  try {
    // Wait for result containers to appear
    await page.waitForSelector(cfg.resultSelector, { timeout: 15000 });
  } catch {
    debug(engine, `No results found for "${keyword}" — selector timeout`);
    return results;
  }

  const items = await page.$$(cfg.resultSelector);
  debug(engine, `Found ${items.length} result containers for "${keyword}"`);

  for (let i = 0; i < items.length; i++) {
    try {
      const item = items[i];

      // ── Find the link element ──
      const linkEl = await item.$(cfg.linkSelector);
      if (!linkEl) continue; // Skip containers without a link (video carousels, AI panels, etc.)

      const url = await linkEl.getAttribute('href');
      if (!url || !url.startsWith('http')) continue; // Skip non-http URLs

      // ── Find the title ──
      let title = '';
      const titleEl = await item.$(cfg.titleSelector);
      if (titleEl) {
        title = (await titleEl.innerText()).trim();
      }
      if (!title) continue; // Skip entries without a title

      // ── Find the snippet ──
      let snippet = '';
      const snippetEl = await item.$(cfg.snippetSelector);
      if (snippetEl) {
        snippet = (await snippetEl.innerText()).trim();
      }

      results.push({
        title,
        url,
        snippet,
        position: results.length + 1,
      });
    } catch {
      // Skip broken elements gracefully
      continue;
    }
  }

  debug(engine, `Extracted ${results.length} valid results for "${keyword}"`);
  return results;
}
