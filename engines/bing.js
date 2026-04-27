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
 * Scrape a single page of Bing results.
 */
async function scrapeBingPage(page, keyword, pageNum, positionOffset) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(cfg.delay.min, cfg.delay.max);

    // CAPTCHA check after page load
    const clear = await checkAndSolveCaptcha(page);
    if (!clear) return [];

    const raw = await extractResults(page, ENGINE, keyword);
    const adjusted = raw.map((r, i) => ({
      ...r,
      position: positionOffset + i + 1,
    }));

    return normalizeAll(adjusted, ENGINE, keyword);
  } catch (err) {
    logError(ENGINE, `Page ${pageNum} extraction failed for "${keyword}": ${err.message}`);
    return [];
  }
}

/**
 * Execute a multi-page Bing search.
 */
async function searchBing(page, keyword) {
  info(ENGINE, `Searching: "${keyword}" (up to ${cfg.maxPages} pages)`);
  const baseOffset = Math.max(0, Math.floor(cfg.offset || 0));
  const allResults = [];

  try {
    // Page 1
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(500, 1000);
    await handleBingConsent(page);

    const page1Results = await scrapeBingPage(page, keyword, 1, baseOffset);
    allResults.push(...page1Results);
    info(ENGINE, `  Page 1: ${page1Results.length} results`);

    // Pages 2–N
    for (let p = 2; p <= cfg.maxPages; p++) {
      try {
        const nextBtn = await page.$(cfg.nextPageSelector);
        if (!nextBtn) {
          debug(ENGINE, `  No next page button found at page ${p - 1}`);
          break;
        }

        await randomDelay(cfg.delay.min, cfg.delay.max);
        await nextBtn.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

        const pageResults = await scrapeBingPage(page, keyword, p, baseOffset + allResults.length);
        if (pageResults.length === 0) {
          debug(ENGINE, `  Page ${p}: no results — stopping pagination`);
          break;
        }

        allResults.push(...pageResults);
        info(ENGINE, `  Page ${p}: ${pageResults.length} results`);
      } catch (err) {
        logError(ENGINE, `  Page ${p} navigation failed: ${err.message}`);
        break;
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
  info(ENGINE, `Starting Bing engine | ${limit} keywords | ${cfg.maxPages} pages each`);
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
