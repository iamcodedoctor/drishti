// DRISHTI v1 — Result Extractor
// Engine-specific DOM extraction logic.
// Handles mixed result containers (videos, AI panels, web results).

import config from '../config.js';
import { debug } from '../core/logger.js';
import { resolveUrl } from './resolver.js';

/**
 * Google SERP DOM changes often (AI layout, class churn). Collect organic rows by
 * title link (h3 → closest anchor) inside main column scopes — no hard dependency on div.g.
 *
 * @param {import('playwright').Page} page
 * @param {string} engine
 * @param {string} keyword
 */
async function extractGoogleOrganic(page, engine, keyword) {
  const results = [];

  const waitSelectors = [
    '#rso h3',
    '#center_col h3',
    '#search h3',
    'div[role="main"] h3',
  ];
  let appeared = false;
  for (const sel of waitSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 6000 });
      appeared = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!appeared) {
    try {
      await page.waitForFunction(
        () =>
          !!document.querySelector('#rso') ||
          !!document.querySelector('#center_col') ||
          !!document.querySelector('div[role="main"] #search'),
        { timeout: 8000 },
      );
      appeared = true;
    } catch {
      debug(
        engine,
        `No results found for "${keyword}" — SERP layout timeout (url=${page.url().slice(0, 120)})`,
      );
      return results;
    }
  }

  const rawRows = await page.evaluate(() => {
    function absolutize(href) {
      if (!href || href.startsWith('#')) return '';
      if (href.startsWith('http')) return href;
      try {
        return new URL(href, 'https://www.google.com').href;
      } catch {
        return '';
      }
    }

    function googleHost(hostname) {
      const h = (hostname || '').replace(/^www\./, '').toLowerCase();
      return h === 'google.com' || h.endsWith('.google.com');
    }

    /** @type {{ title: string, href: string, snippet: string }[]} */
    const rows = [];
    const seenHref = new Set();

    const seenH3 = new Set();
    const rootSelectors = ['#rso', '#center_col', '#search', 'div[role="main"]'];

    for (const sel of rootSelectors) {
      const root = document.querySelector(sel);
      if (!root) continue;
      for (const h3 of root.querySelectorAll('h3')) {
        if (seenH3.has(h3)) continue;
        seenH3.add(h3);
        const a = h3.closest('a');
        if (!a) continue;
        const href = absolutize(a.getAttribute('href') || '');
        if (!href.startsWith('http')) continue;

        const title = (h3.innerText || '').trim();
        if (title.length < 2) continue;

        try {
          if (googleHost(new URL(href).hostname)) continue;
        } catch {
          continue;
        }

        if (seenHref.has(href)) continue;
        seenHref.add(href);

        let snippet = '';
        const card =
          a.closest(
            'div.g, div.MjjYud, div.Ww4FFb, div.tF2Cxc, div.Gx5Zad, div[data-hveid], li',
          ) || a.parentElement;
        if (card) {
          const snippetCandidates = card.querySelectorAll(
            '.VwiC3b, .yXK7nf, .IsZvec, .lEBKkf, .Y3v8qd, .MUxGbd, [data-sncf], span.st',
          );
          for (const sn of snippetCandidates) {
            if (h3.contains(sn) || sn.contains(h3)) continue;
            const t = (sn.innerText || '').trim();
            if (t.length > 15) {
              snippet = t;
              break;
            }
          }
        }

        rows.push({
          title,
          href,
          snippet: snippet.slice(0, 600),
        });
      }
    }

    return rows;
  });

  const seenResolved = new Set();
  for (const row of rawRows) {
    let url = resolveUrl(row.href);
    if (!url.startsWith('http')) continue;
    try {
      const host = new URL(url).hostname;
      if (host === 'google.com' || host.endsWith('.google.com')) continue;
    } catch {
      continue;
    }
    if (seenResolved.has(url)) continue;
    seenResolved.add(url);

    results.push({
      title: row.title,
      url,
      snippet: row.snippet || '',
      position: results.length + 1,
    });
  }

  debug(engine, `Extracted ${results.length} valid Google results for "${keyword}"`);
  return results;
}

/**
 * Extract search results from the current page.
 * Handles Google's MjjYud containers (which wrap mixed content types),
 * Bing's li.b_algo, and DuckDuckGo's article elements.
 *
 * @param {import('playwright').Page} page
 * @param {string} engine - 'bing' | 'duckduckgo' | 'google'
 * @param {string} keyword - The search query
 * @returns {Promise<Array<{ title: string, url: string, snippet: string, position: number }>>}
 */
export async function extractResults(page, engine, keyword) {
  if (engine === 'google') {
    return extractGoogleOrganic(page, engine, keyword);
  }

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

      let url = await linkEl.getAttribute('href');
      if (!url) continue;
      url = resolveUrl(url);
      if (!url.startsWith('http')) continue;

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
