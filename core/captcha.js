// DRISHTI v1 — CAPTCHA Detector
// Shared CAPTCHA detection and manual solve logic for all engines.

import { randomDelay } from './delay.js';
import { warn, debug, info, error as logError } from './logger.js';
import config from '../config.js';

/**
 * Detect if the current page has a CAPTCHA or block.
 * Works for Bing, DuckDuckGo, and generic CAPTCHA pages.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function hasCaptcha(page) {
  try {
    const url = page.url();

    // Bing blocks
    if (url.includes('/sorry/') || url.includes('cc.bing.com')) {
      return true;
    }

    // Generic CAPTCHA indicators
    const captchaSelectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="captcha"]',
      'iframe[src*="challenge"]',
      '#captcha-form',
      'form[action*="CaptchaRedirect"]',
      'div.g-recaptcha',
      'div#recaptcha',
      'div[class*="captcha"]',
      'img[src*="captcha"]',
    ];

    for (const sel of captchaSelectors) {
      const el = await page.$(sel);
      if (el) return true;
    }

    // Check page text for block messages
    const bodyText = await page.evaluate(() =>
      (document.body?.innerText || '').slice(0, 3000).toLowerCase()
    );

    const blockPhrases = [
      'unusual traffic',
      'not a robot',
      'automated queries',
      'captcha',
      'verify you are human',
      'blocked',
      'access denied',
      'please verify',
      'security check',
      'are you a robot',
    ];

    for (const phrase of blockPhrases) {
      if (bodyText.includes(phrase)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Wait for user to manually solve CAPTCHA.
 * Polls every 5 seconds for up to captchaTimeout seconds.
 * @param {import('playwright').Page} page
 * @param {string} engine - Engine name for logging
 * @returns {Promise<boolean>} true if CAPTCHA was solved
 */
export async function waitForCaptchaSolve(page, engine) {
  const timeout = config.browser.captchaTimeout || 120;
  const checks = Math.ceil(timeout / 5);

  warn(engine, `🚨 CAPTCHA DETECTED — You have ${timeout}s to solve it in the browser window!`);

  for (let i = 0; i < checks; i++) {
    await randomDelay(5000, 5000);

    // Check if page navigated away from CAPTCHA (user solved it)
    const still = await hasCaptcha(page);
    if (!still) {
      info(engine, '✅ CAPTCHA solved — resuming');
      await randomDelay(1000, 2000); // Let page settle
      return true;
    }

    const elapsed = (i + 1) * 5;
    debug(engine, `CAPTCHA still present... ${elapsed}s / ${timeout}s`);
  }

  logError(engine, `❌ CAPTCHA not solved within ${timeout}s — skipping`);
  return false;
}
