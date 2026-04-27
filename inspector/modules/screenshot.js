// INSPECTOR-GENERAL v1 — Screenshot Capture
// Takes screenshots at multiple device sizes.

import { join } from 'node:path';
import { createPage } from '../core/browser.js';
import { info, error as logError, debug } from '../core/logger.js';
import inspectorConfig from '../config.js';

/**
 * Take screenshots of a URL at all configured device sizes.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {string} outputDir - Folder to save screenshots
 * @param {string} domain
 * @returns {Promise<string[]>} Paths of saved screenshots
 */
export async function captureScreenshots(browser, url, outputDir, domain) {
  const saved = [];

  for (const device of inspectorConfig.devices) {
    let page;
    try {
      page = await createPage(browser, { width: device.width, height: device.height });

      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: inspectorConfig.browser.timeout,
      });

      // Wait a bit for lazy-loaded content
      await new Promise((r) => setTimeout(r, 1500));

      const screenshotPath = join(outputDir, `${device.name}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage: false, // viewport-only (faster, more useful)
      });

      saved.push(screenshotPath);
      debug(domain, `Screenshot: ${device.name} (${device.width}x${device.height})`);
    } catch (err) {
      logError(domain, `Screenshot ${device.name} failed: ${err.message}`);
    } finally {
      if (page) {
        try { await page.context().close(); } catch {}
      }
    }
  }

  info(domain, `Screenshots: ${saved.length}/${inspectorConfig.devices.length} captured`);
  return saved;
}
