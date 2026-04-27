// DRISHTI v1 — DuckDuckGo Engine
// Headful mode with CAPTCHA detection + 5-page via "More Results" button.

import { launchBrowser, closeBrowser } from '../core/browser.js';
import { randomDelay } from '../core/delay.js';
import { hasCaptcha, waitForCaptchaSolve } from '../core/captcha.js';
import { extractResults } from '../parser/extract.js';
import { normalizeAll } from '../parser/normalize.js';
import { writeResults } from '../output/writer.js';
import { info, error as logError, debug, warn } from '../core/logger.js';
import config from '../config.js';

const ENGINE = 'duckduckgo';
const cfg = config.engines[ENGINE];

/**
 * Check for CAPTCHA and wait for manual solve if detected.
 */
async function checkAndSolveCaptcha(page) {
  if (await hasCaptcha(page)) {
    const solved = await waitForCaptchaSolve(page, ENGINE);
    return solved;
  }
  return true;
}

/**
 * Execute a multi-page DuckDuckGo search.
 */
async function searchDDG(page, keyword) {
  info(ENGINE, `Searching: "${keyword}" (up to ${cfg.maxPages} pages)`);
  const allResults = [];

  try {
    // Page 1
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(cfg.delay.min, cfg.delay.max);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(500, 1000);

    // CAPTCHA check
    const clear = await checkAndSolveCaptcha(page);
    if (!clear) return allResults;

    const page1Raw = await extractResults(page, ENGINE, keyword);
    const page1 = normalizeAll(page1Raw, ENGINE, keyword);
    allResults.push(...page1);
    info(ENGINE, `  Page 1: ${page1.length} results`);

    // Pages 2–N via "More Results"
    for (let p = 2; p <= cfg.maxPages; p++) {
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await randomDelay(500, 1000);

        const moreBtn = await page.$(cfg.moreResultsSelector);
        if (!moreBtn) {
          debug(ENGINE, `  No "More Results" button found at page ${p}`);
          break;
        }

        const countBefore = (await page.$$(cfg.resultSelector)).length;

        await randomDelay(cfg.delay.min, cfg.delay.max);
        await moreBtn.click();
        await randomDelay(1500, 3000);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // CAPTCHA check after loading more
        const clearAfter = await checkAndSolveCaptcha(page);
        if (!clearAfter) break;

        const allRaw = await extractResults(page, ENGINE, keyword);
        const newResults = allRaw.slice(countBefore);

        if (newResults.length === 0) {
          debug(ENGINE, `  Page ${p}: no new results — stopping pagination`);
          break;
        }

        const adjusted = newResults.map((r, i) => ({
          ...r,
          position: allResults.length + i + 1,
        }));

        const normalized = normalizeAll(adjusted, ENGINE, keyword);
        allResults.push(...normalized);
        info(ENGINE, `  Page ${p}: ${normalized.length} new results`);
      } catch (err) {
        logError(ENGINE, `  Page ${p} failed: ${err.message}`);
        break;
      }
    }
  } catch (err) {
    logError(ENGINE, `Search failed for "${keyword}": ${err.message}`);
  }

  return allResults;
}

/**
 * Run DuckDuckGo engine.
 */
export async function runDuckDuckGo(keywords) {
  const limit = Math.min(keywords.length, cfg.maxQueries);
  info(ENGINE, `Starting DuckDuckGo engine | ${limit} keywords | ${cfg.maxPages} pages each`);
  warn(ENGINE, 'Headful mode — browser window will be visible. Solve CAPTCHAs if they appear.');

  let browser, page;

  try {
    ({ browser, page } = await launchBrowser(ENGINE));

    for (let i = 0; i < limit; i++) {
      const keyword = keywords[i].trim();
      if (!keyword) continue;

      info(ENGINE, `[${i + 1}/${limit}] Processing: "${keyword}"`);

      try {
        const results = await searchDDG(page, keyword);
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
