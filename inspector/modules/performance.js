// INSPECTOR-GENERAL v1 — Performance Capture
// Measures page load and DOMContentLoaded times via Playwright.

import { createPage } from '../core/browser.js';
import { info, error as logError } from '../core/logger.js';
import inspectorConfig from '../config.js';

/**
 * Capture performance metrics for a URL.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {string} domain
 * @returns {Promise<object>} Performance metrics
 */
export async function capturePerformance(browser, url, domain) {
  let page;
  try {
    page = await createPage(browser, { width: 1920, height: 1080 });

    const startTime = Date.now();

    const response = await page.goto(url, {
      waitUntil: 'load',
      timeout: inspectorConfig.browser.timeout,
    });

    const loadTime = Date.now() - startTime;

    // Extract browser timing metrics
    const timing = await page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0];
      if (!perf) return null;
      return {
        domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
        loadEvent: Math.round(perf.loadEventEnd - perf.startTime),
        ttfb: Math.round(perf.responseStart - perf.startTime),
        domInteractive: Math.round(perf.domInteractive - perf.startTime),
        transferSize: perf.transferSize || 0,
      };
    });

    const metrics = {
      url,
      status_code: response ? response.status() : null,
      load_time_ms: timing?.loadEvent || loadTime,
      dom_content_loaded_ms: timing?.domContentLoaded || null,
      ttfb_ms: timing?.ttfb || null,
      dom_interactive_ms: timing?.domInteractive || null,
      transfer_size_bytes: timing?.transferSize || null,
      measured_at: new Date().toISOString(),
    };

    info(domain, `Performance: load=${metrics.load_time_ms}ms | DCL=${metrics.dom_content_loaded_ms}ms | TTFB=${metrics.ttfb_ms}ms`);
    return metrics;
  } catch (err) {
    logError(domain, `Performance capture failed: ${err.message}`);
    return {
      url,
      error: err.message,
      load_time_ms: null,
      dom_content_loaded_ms: null,
      measured_at: new Date().toISOString(),
    };
  } finally {
    if (page) {
      try { await page.context().close(); } catch {}
    }
  }
}
