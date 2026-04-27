// INSPECTOR-GENERAL v1 — Browser Setup
// Lightweight Playwright launcher for inspection (no stealth needed).

import { chromium } from 'playwright';
import inspectorConfig from '../config.js';
import { info } from './logger.js';

/**
 * Launch a headless browser for inspection.
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchInspectorBrowser() {
  const browser = await chromium.launch({
    headless: inspectorConfig.browser.headless,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  info('BROWSER', 'Inspector browser launched');
  return browser;
}

/**
 * Create a new page with a specific viewport.
 * @param {import('playwright').Browser} browser
 * @param {{ width: number, height: number }} viewport
 * @returns {Promise<import('playwright').Page>}
 */
export async function createPage(browser, viewport = { width: 1920, height: 1080 }) {
  const context = await browser.newContext({
    viewport,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  });
  return context.newPage();
}

/**
 * Close browser.
 */
export async function closeBrowser(browser) {
  try {
    await browser.close();
    info('BROWSER', 'Inspector browser closed');
  } catch {}
}
