// DRISHTI v1 — Bing Engine
// Headful mode with CAPTCHA detection + 5-page pagination.

import { launchBrowser, closeBrowser } from '../core/browser.js';
import { randomDelay } from '../core/delay.js';
import { hasCaptcha, waitForCaptchaSolve } from '../core/captcha.js';
import { extractResults } from '../parser/extract.js';
import { normalizeAll } from '../parser/normalize.js';
import { writeResults } from '../output/writer.js';
import { info, error as logError, debug, warn } from '../core/logger.js';
import config from '../config.js';

const ENGINE = 'bing';
const cfg = config.engines[ENGINE];

/**
 * Handle Bing cookie consent overlay if present.
 */
async function handleBingConsent(page) {
  try {
    const consentSelectors = [
      '#bnp_btn_accept',
      'button#bnp_btn_accept',
      'button:has-text("Accept")',
      'button:has-text("I agree")',
    ];
    for (const sel of consentSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        debug(ENGINE, 'Handling Bing consent dialog');
        await btn.click();
        await randomDelay(1000, 2000);
        break;
      }
    }
  } catch { /* no consent dialog */ }
}

/**
 * Check for CAPTCHA and wait for manual solve if detected.
 * @returns {Promise<boolean>} true if clear to proceed
 */
async function checkAndSolveCaptcha(page) {
  if (await hasCaptcha(page)) {
    const solved = await waitForCaptchaSolve(page, ENGINE);
    return solved;
  }
  return true;
}

/**
 * Wait for Bing SERP to settle (skip extraction — offset “pages to skip”).
 */
async function visitBingPageOnly(page, keyword, serpPageLabel) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(cfg.delay.min, cfg.delay.max);
    const clear = await checkAndSolveCaptcha(page);
    if (!clear) return false;
    debug(ENGINE, `  SERP page ${serpPageLabel}: visit only (no extract) for "${keyword}"`);
    return true;
  } catch (err) {
    logError(ENGINE, `  Visit-only page ${serpPageLabel} failed: ${err.message}`);
    return false;
  }
}

/**
 * Scrape a single page of Bing results.
 */
async function scrapeBingPage(page, keyword, pageNum) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(cfg.delay.min, cfg.delay.max);

    const clear = await checkAndSolveCaptcha(page);
    if (!clear) return [];

    const raw = await extractResults(page, ENGINE, keyword);
    const adjusted = raw.map((r, i) => ({
      ...r,
      position: i + 1,
    }));

    return normalizeAll(adjusted, ENGINE, keyword);
  } catch (err) {
    logError(ENGINE, `Page ${pageNum} extraction failed for "${keyword}": ${err.message}`);
    return [];
  }
}

async function bingClickNext(page) {
  const nextBtn = await page.$(cfg.nextPageSelector);
  if (!nextBtn) return false;
  await randomDelay(cfg.delay.min, cfg.delay.max);
  await nextBtn.click();
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  return true;
}

/**
 * Execute a multi-page Bing search.
 * offset = SERP pages to open without extracting; maxPages = pages to scrape after that.
 */
async function searchBing(page, keyword) {
  const pagesToSkip = Math.max(0, Math.floor(cfg.offset || 0));
  const pagesToExtract = Math.max(0, Math.floor(cfg.maxPages || 0));
  info(
    ENGINE,
    `Searching: "${keyword}" | skip ${pagesToSkip} page(s) without extract, then scrape ${pagesToExtract} page(s)`,
  );
  const allResults = [];

  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(500, 1000);
    await handleBingConsent(page);

    let serpIndex = 1;

    for (let s = 0; s < pagesToSkip; s++) {
      const ok = await visitBingPageOnly(page, keyword, serpIndex);
      if (!ok) return allResults;
      const moved = await bingClickNext(page);
      if (!moved) {
        debug(ENGINE, `  No next page while skipping (at SERP ${serpIndex})`);
        return allResults;
      }
      serpIndex += 1;
    }

    for (let p = 0; p < pagesToExtract; p++) {
      const pageResults = await scrapeBingPage(page, keyword, serpIndex);
      const renumbered = pageResults.map((r, i) => ({
        ...r,
        position: allResults.length + i + 1,
      }));
      allResults.push(...renumbered);
      info(ENGINE, `  SERP page ${serpIndex}: ${pageResults.length} results (extract)`);

      if (pageResults.length === 0) {
        debug(ENGINE, `  SERP ${serpIndex}: no results — stopping`);
        break;
      }

      if (p < pagesToExtract - 1) {
        const moved = await bingClickNext(page);
        if (!moved) {
          debug(ENGINE, `  No next page after SERP ${serpIndex}`);
          break;
        }
        serpIndex += 1;
      }
    }
  } catch (err) {
    logError(ENGINE, `Search failed for "${keyword}": ${err.message}`);
  }

  return allResults;
}

/**
 * Run Bing engine.
 */
export async function runBing(keywords) {
  const limit = Math.min(keywords.length, cfg.maxQueries);
  info(
    ENGINE,
    `Starting Bing engine | ${limit} keywords | extract ${cfg.maxPages} page(s), skip ${cfg.offset || 0} without extract`,
  );
  warn(ENGINE, 'Headful mode — browser window will be visible. Solve CAPTCHAs if they appear.');

  let browser, page;

  try {
    ({ browser, page } = await launchBrowser(ENGINE));

    for (let i = 0; i < limit; i++) {
      const keyword = keywords[i].trim();
      if (!keyword) continue;

      info(ENGINE, `[${i + 1}/${limit}] Processing: "${keyword}"`);

      try {
        const results = await searchBing(page, keyword);
        writeResults(results, ENGINE);
        info(ENGINE, `[${i + 1}/${limit}] Total: ${results.length} results across pages`);
      } catch (err) {
        logError(ENGINE, `[${i + 1}/${limit}] Failed: ${err.message}`);
      }

      if (i < limit - 1) {
        await randomDelay(cfg.delay.min, cfg.delay.max);
      }
    }
  } catch (err) {
    logError(ENGINE, `Engine crash: ${err.message}`);
  } finally {
    if (browser) await closeBrowser(browser, ENGINE);
    info(ENGINE, 'Engine finished');
  }
}
