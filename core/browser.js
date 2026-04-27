// DRISHTI v1 — Browser Launcher
// Stealth-patched Playwright with deep anti-detection evasion.

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { generateFingerprint } from './fingerprint.js';
import { info, debug } from './logger.js';
import config from '../config.js';

// Apply stealth patches globally (once)
chromium.use(StealthPlugin());

/**
 * Launch a browser session with maximum stealth.
 * @param {string} engine - Engine name ('google' | 'bing' | 'duckduckgo')
 * @returns {Promise<{ browser, context, page, fingerprint }>}
 */
export async function launchBrowser(engine) {
  const engineConfig = config.engines[engine];
  const fingerprint = generateFingerprint();

  info(engine, `Launching browser | headless=${engineConfig.headless} | UA=${fingerprint.userAgent.slice(0, 60)}...`);

  const launchOptions = {
    headless: engineConfig.headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1920,1080',
    ],
  };

  // Proxy support
  if (config.browser.proxy) {
    launchOptions.proxy = { server: config.browser.proxy };
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent: fingerprint.userAgent,
    viewport: fingerprint.viewport,
    timezoneId: fingerprint.timezone,
    locale: fingerprint.locale,
    javaScriptEnabled: true,
    // Permissions that a real browser would have
    permissions: ['geolocation'],
    // Color scheme preference (looks more human)
    colorScheme: 'light',
  });

  // Deep stealth init scripts
  await context.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Override chrome runtime to look like real Chrome
    window.chrome = {
      runtime: {
        onConnect: { addListener: () => {}, removeListener: () => {} },
        onMessage: { addListener: () => {}, removeListener: () => {} },
        sendMessage: () => {},
        connect: () => {},
      },
      loadTimes: () => ({
        requestTime: Date.now() / 1000 - Math.random() * 2,
        startLoadTime: Date.now() / 1000 - Math.random(),
        commitLoadTime: Date.now() / 1000 - Math.random() * 0.5,
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintTime: Date.now() / 1000 - Math.random() * 0.3,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      }),
      csi: () => ({
        startE: Date.now(),
        onloadT: Date.now(),
        pageT: Math.random() * 1000 + 500,
        tran: 15,
      }),
    };

    // Override permissions API
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery(parameters);
      };
    }

    // Override plugins to look like real Chrome
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IN', 'en', 'hi'],
    });

    // Spoof hardware concurrency (real browsers report actual cores)
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // Spoof device memory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });

    // Override connection info
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    }
  });

  const page = await context.newPage();

  info(engine, `Browser ready | viewport=${fingerprint.viewport.width}x${fingerprint.viewport.height} | tz=${fingerprint.timezone} | locale=${fingerprint.locale}`);

  return { browser, context, page, fingerprint };
}

/**
 * Gracefully close browser.
 */
export async function closeBrowser(browser, engine) {
  try {
    await browser.close();
    info(engine, 'Browser closed');
  } catch {
    // Browser may already be closed
  }
}
