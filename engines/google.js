// DRISHTI v1 — Google Engine
// Headful, human-like pointer/scroll pacing, optional new-tab visits, manual CAPTCHA.

import { platform } from 'node:process';
import { launchBrowser, closeBrowser } from '../core/browser.js';
import { randomDelay } from '../core/delay.js';
import {
  humanUnevenScroll,
  humanHoverElement,
  humanClickElement,
  humanTypeFocused,
  randomMouseMove,
  idle,
} from '../core/behavior.js';
import { hasCaptcha, waitForCaptchaSolve } from '../core/captcha.js';
import { extractResults } from '../parser/extract.js';
import { normalizeAll } from '../parser/normalize.js';
import { writeResults } from '../output/writer.js';
import { info, error as logError, debug, warn } from '../core/logger.js';
import config from '../config.js';

const ENGINE = 'google';
const cfg = config.engines[ENGINE];
const NEW_TAB_MODIFIER = platform === 'darwin' ? 'Meta' : 'Control';

async function checkAndSolveCaptcha(page) {
  if (await hasCaptcha(page)) {
    return waitForCaptchaSolve(page, ENGINE);
  }
  return true;
}

async function handleGoogleConsent(page) {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'div[role="none"] button:has-text("Accept")',
    '#L2AGLb',
    'form[action*="consent"] button',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible())) {
        debug(ENGINE, 'Dismissing Google consent');
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await humanClickElement(page, btn);
        await randomDelay(800, 1600);
        return;
      }
    } catch {
      /* next */
    }
  }
}

async function runBehaviorHooks(page) {
  const b = cfg.behavior || {};
  if (b.randomMouse) await randomMouseMove(page, 2 + Math.floor(Math.random() * 2));
  if (b.randomScroll) await humanUnevenScroll(page);
  if (b.idle) await idle(page, { min: 1200, max: 3500 });
}

/**
 * Open one organic result in a new tab, linger, close — then return focus to SERP.
 */
async function maybeVisitResultInNewTab(context, page) {
  const b = cfg.behavior || {};
  if (!b.openRandomTabs || Math.random() > 0.42) return;

  let links = await page.$$('#rso a:has(h3)');
  if (links.length < 2) {
    links = await page.$$('#center_col a:has(h3)');
  }
  if (links.length < 2) return;

  const idx = Math.floor(Math.random() * Math.min(links.length, 6));
  const link = links[idx];
  const href = await link.getAttribute('href');
  if (!href || href.startsWith('#')) return;

  await humanHoverElement(page, link);
  await randomDelay(200, 600);

  const popup = context.waitForEvent('page', { timeout: 12000 }).catch(() => null);
  await page.keyboard.down(NEW_TAB_MODIFIER);
  await randomDelay(40, 100);
  const box = await link.boundingBox();
  if (box) {
    const cx = box.x + box.width * 0.4;
    const cy = box.y + box.height * 0.45;
    await page.mouse.click(cx, cy);
  }
  await page.keyboard.up(NEW_TAB_MODIFIER);

  const newPage = await popup;
  if (!newPage) return;

  try {
    await newPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    await randomDelay(1800, 5200);
    if (Math.random() > 0.45) await humanUnevenScroll(newPage).catch(() => {});
  } finally {
    await newPage.close().catch(() => {});
    await page.bringToFront().catch(() => {});
    await randomDelay(400, 1100);
  }
}

async function humanSearch(page, keyword) {
  await page.waitForSelector(cfg.searchInputSelector, { timeout: 20000 });
  const input = await page.$(cfg.searchInputSelector);
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await humanClickElement(page, input);
  await randomDelay(200, 500);
  if (NEW_TAB_MODIFIER === 'Meta') {
    await page.keyboard.press('Meta+a');
  } else {
    await page.keyboard.press('Control+a');
  }
  await randomDelay(80, 220);
  await humanTypeFocused(page, keyword, cfg.keystrokeDelay);
  await randomDelay(400, 1200);

  const submit = await page.$('input[name="btnK"][type="submit"]');
  if (submit && (await submit.isVisible())) {
    await humanClickElement(page, submit);
  } else {
    await page.keyboard.press('Enter');
  }
}

async function humanClickNextPage(page) {
  const selectors = [
    cfg.nextPageSelector,
    'a#pnnext',
    'footer a#pnnext',
    'a[aria-label="Next"]',
    'a[aria-label="Next page"]',
    'a[rel="next"]',
  ];
  for (const sel of selectors) {
    let next;
    try {
      next = await page.$(sel);
    } catch {
      continue;
    }
    if (!next) continue;
    const vis = await next.isVisible().catch(() => false);
    if (!vis) continue;
    await next.scrollIntoViewIfNeeded().catch(() => {});
    await humanHoverElement(page, next);
    await randomDelay(150, 450);
    const box = await next.boundingBox();
    if (!box) continue;
    await page.mouse.click(
      box.x + box.width * 0.5,
      box.y + box.height * 0.5,
    );
    return true;
  }
  return false;
}

async function visitGoogleSerpOnly(page, context, keyword, serpPageLabel) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {});
    await randomDelay(cfg.delay.min, cfg.delay.max);

    const clear = await checkAndSolveCaptcha(page);
    if (!clear) return false;

    await runBehaviorHooks(page);
    await maybeVisitResultInNewTab(context, page);
    await humanUnevenScroll(page);
    await randomDelay(300, 900);
    debug(ENGINE, `  SERP page ${serpPageLabel}: visit only (no extract) for "${keyword}"`);
    return true;
  } catch (err) {
    logError(ENGINE, `  Visit-only SERP ${serpPageLabel} failed: ${err.message}`);
    return false;
  }
}

async function scrapeGooglePageExtract(page, context, keyword, serpPageLabel) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {});
    await randomDelay(cfg.delay.min, cfg.delay.max);

    const clear = await checkAndSolveCaptcha(page);
    if (!clear) return [];

    await runBehaviorHooks(page);
    await maybeVisitResultInNewTab(context, page);
    await humanUnevenScroll(page);
    await randomDelay(300, 900);

    const raw = await extractResults(page, ENGINE, keyword);
    const adjusted = raw.map((r, i) => ({
      ...r,
      position: i + 1,
    }));

    return normalizeAll(adjusted, ENGINE, keyword);
  } catch (err) {
    logError(ENGINE, `SERP ${serpPageLabel} extraction failed for "${keyword}": ${err.message}`);
    return [];
  }
}

async function searchGoogle(context, page, keyword) {
  const pagesToSkip = Math.max(0, Math.floor(cfg.offset || 0));
  const pagesToExtract = Math.max(0, Math.floor(cfg.maxPages || 0));
  info(
    ENGINE,
    `Searching: "${keyword}" | google.com + typed query, skip ${pagesToSkip} SERP page(s) without extract, then scrape ${pagesToExtract} page(s)`,
  );
  const allResults = [];

  try {
    await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay(600, 1400);
    await handleGoogleConsent(page);
    await runBehaviorHooks(page);

    const clearHome = await checkAndSolveCaptcha(page);
    if (!clearHome) return allResults;

    await humanSearch(page, keyword);
    await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
    await randomDelay(500, 1200);

    const clearSerp = await checkAndSolveCaptcha(page);
    if (!clearSerp) return allResults;

    let serpIndex = 1;

    for (let s = 0; s < pagesToSkip; s++) {
      const ok = await visitGoogleSerpOnly(page, context, keyword, serpIndex);
      if (!ok) return allResults;
      const moved = await humanClickNextPage(page);
      if (!moved) {
        debug(ENGINE, `  No next page while skipping (at SERP ${serpIndex})`);
        return allResults;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
      await randomDelay(400, 1000);
      const clearP = await checkAndSolveCaptcha(page);
      if (!clearP) return allResults;
      serpIndex += 1;
    }

    for (let p = 0; p < pagesToExtract; p++) {
      try {
        await randomDelay(cfg.delay.min, cfg.delay.max);
        const pageResults = await scrapeGooglePageExtract(page, context, keyword, serpIndex);
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
          const clicked = await humanClickNextPage(page);
          if (!clicked) {
            debug(ENGINE, `  No next page after SERP ${serpIndex}`);
            break;
          }
          await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
          await randomDelay(400, 1000);
          const clearN = await checkAndSolveCaptcha(page);
          if (!clearN) break;
          serpIndex += 1;
        }
      } catch (err) {
        logError(ENGINE, `  SERP ${serpIndex} failed: ${err.message}`);
        break;
      }
    }
  } catch (err) {
    logError(ENGINE, `Search failed for "${keyword}": ${err.message}`);
  }

  return allResults;
}

export async function runGoogle(keywords) {
  const limit = Math.min(keywords.length, cfg.maxQueries);
  info(
    ENGINE,
    `Starting Google engine | ${limit} keywords | extract ${cfg.maxPages} SERP page(s), skip ${cfg.offset || 0} without extract`,
  );
  warn(
    ENGINE,
    'Headful mode — use slow, pointer-driven actions. Solve CAPTCHAs in the browser if shown.',
  );

  let browser;
  let context;
  let page;

  try {
    ({ browser, context, page } = await launchBrowser(ENGINE));

    for (let i = 0; i < limit; i++) {
      const keyword = keywords[i].trim();
      if (!keyword) continue;

      info(ENGINE, `[${i + 1}/${limit}] Processing: "${keyword}"`);

      try {
        const results = await searchGoogle(context, page, keyword);
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
