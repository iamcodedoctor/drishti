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

async function visitDDGBatchOnly(page, keyword, batchLabel) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await randomDelay(cfg.delay.min, cfg.delay.max);
  const clear = await checkAndSolveCaptcha(page);
  if (!clear) return false;
  debug(ENGINE, `  DDG batch ${batchLabel}: visit only (no extract) for "${keyword}"`);
  return true;
}

async function clickMoreResultsDDG(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await randomDelay(500, 1000);
  const moreBtn = await page.$(cfg.moreResultsSelector);
  if (!moreBtn) return false;
  await randomDelay(cfg.delay.min, cfg.delay.max);
  await moreBtn.click();
  await randomDelay(1500, 3000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  return true;
}

/**
 * offset = initial "More results" batches to load and view without extracting.
 * maxPages = number of batches to extract after that (each batch = one More click after the first slice, except the first extract uses the current DOM).
 */
async function searchDDG(page, keyword) {
  const batchesToSkip = Math.max(0, Math.floor(cfg.offset || 0));
  const batchesToExtract = Math.max(0, Math.floor(cfg.maxPages || 0));
  info(
    ENGINE,
    `Searching: "${keyword}" | skip ${batchesToSkip} batch(es) without extract, then scrape ${batchesToExtract} batch(es)`,
  );
  const allResults = [];

  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(cfg.delay.min, cfg.delay.max);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(500, 1000);

    const clear = await checkAndSolveCaptcha(page);
    if (!clear) return allResults;

    let sliceStart = 0;

    for (let s = 0; s < batchesToSkip; s++) {
      const ok = await visitDDGBatchOnly(page, keyword, s + 1);
      if (!ok) return allResults;
      const n = (await page.$$(cfg.resultSelector)).length;
      const moved = await clickMoreResultsDDG(page);
      if (!moved) {
        debug(ENGINE, `  No "More Results" while skipping (batch ${s + 1})`);
        return allResults;
      }
      const clearAfter = await checkAndSolveCaptcha(page);
      if (!clearAfter) return allResults;
      sliceStart = n;
    }

    for (let p = 0; p < batchesToExtract; p++) {
      try {
        const clearMid = await checkAndSolveCaptcha(page);
        if (!clearMid) break;

        const allRaw = await extractResults(page, ENGINE, keyword);
        const slice = allRaw.slice(sliceStart);
        sliceStart = allRaw.length;

        if (slice.length === 0) {
          debug(ENGINE, `  Extract batch ${p + 1}: no new results — stopping`);
          break;
        }

        const adjusted = slice.map((r, i) => ({
          ...r,
          position: allResults.length + i + 1,
        }));
        const normalized = normalizeAll(adjusted, ENGINE, keyword);
        allResults.push(...normalized);
        info(ENGINE, `  Extract batch ${p + 1}: ${normalized.length} results`);

        if (p < batchesToExtract - 1) {
          const moved = await clickMoreResultsDDG(page);
          if (!moved) {
            debug(ENGINE, '  No "More Results" for next batch');
            break;
          }
          const clearAfter = await checkAndSolveCaptcha(page);
          if (!clearAfter) break;
        }
      } catch (err) {
        logError(ENGINE, `  Extract batch ${p + 1} failed: ${err.message}`);
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
  info(
    ENGINE,
    `Starting DuckDuckGo engine | ${limit} keywords | extract ${cfg.maxPages} batch(es), skip ${cfg.offset || 0} without extract`,
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
