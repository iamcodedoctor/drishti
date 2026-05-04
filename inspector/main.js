// INSPECTOR-GENERAL v1 — Main Pipeline
// Reads cleaned results and performs deep technical analysis on each domain.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import inspectorConfig from './config.js';
import { parseDomains } from './input/parser.js';
import { launchInspectorBrowser, closeBrowser } from './core/browser.js';
import { capturePerformance } from './modules/performance.js';
import { captureScreenshots } from './modules/screenshot.js';
import { fetchHTML } from './modules/htmlFetcher.js';
import { analyzeSEO } from './modules/seoAnalyzer.js';
import { analyzeTags } from './modules/tagAnalyzer.js';
import { analyzeLinks } from './modules/linkAnalyzer.js';
import { basicCrawl } from './modules/crawler.js';
import { writePerformance, writeSEOReport } from './output/reporter.js';
import { info, error as logError, warn } from './core/logger.js';

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Inspect a single domain (browser-safe: modules use their own contexts).
 */
async function inspectSingleDomain(browser, { domain, url }, position, total) {
  info('MAIN', `\n[${position + 1}/${total}] Inspecting: ${domain}`);

  const domainDir = join(inspectorConfig.outputDir, domain);
  mkdirSync(domainDir, { recursive: true });

  let seoData = null;
  let tagData = null;
  let linkData = null;
  let crawledCount = 0;

  try {
    info(domain, `Phase 1: Performance Capture`);
    const perfData = await capturePerformance(browser, url, domain);
    writePerformance(domainDir, perfData, domain);

    if (inspectorConfig.captureScreenshots) {
      info(domain, `Phase 2: Screenshots`);
      await captureScreenshots(browser, url, domainDir, domain);
    } else {
      info(domain, `Phase 2: Screenshots (Skipped via config)`);
    }

    info(domain, `Phase 3: HTML & SEO Analysis`);
    const fetchResult = await fetchHTML(url, domain);

    if (fetchResult && fetchResult.html) {
      seoData = analyzeSEO(fetchResult.html, url);
      tagData = analyzeTags(fetchResult.html);

      info(domain, `Phase 4: Linking & Crawling`);
      linkData = await analyzeLinks(fetchResult.html, url, domain);
      const crawledPages = await basicCrawl(url, domain);
      crawledCount = crawledPages.length;
    } else {
      warn(domain, 'Skipping deep analysis (failed to fetch HTML)');
    }

    info(domain, `Phase 5: Report Generation`);
    writeSEOReport(domainDir, { seoData, tagData, linkData, crawledPages: crawledCount }, domain);

    info('MAIN', `✅ Completed: ${domain}`);
  } catch (err) {
    logError(domain, `Fatal error analyzing domain: ${err.message}`);
  }
}

/**
 * Process domains with a fixed pool of concurrent workers.
 */
async function runInspectionPool(browser, domains) {
  const total = domains.length;
  const concurrency = Math.max(
    1,
    Math.min(
      Math.floor(inspectorConfig.concurrency || 1),
      total,
    ),
  );

  info('MAIN', `Concurrency: ${concurrency} worker(s)`);

  let nextIndex = 0;
  const { min, max } = inspectorConfig.delayBetweenDomains;

  async function worker(workerId) {
    while (true) {
      const idx = nextIndex++;
      if (idx >= total) return;

      await inspectSingleDomain(browser, domains[idx], idx, total);

      if (nextIndex < total && max >= min) {
        const waitMs = randomBetween(min, max);
        info('MAIN', `[worker ${workerId}] Waiting ${waitMs}ms before next domain...`);
        await delay(waitMs);
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, w) => worker(w + 1)),
  );
}

async function main() {
  info('MAIN', '═══════════════════════════════════════');
  info('MAIN', '  INSPECTOR-GENERAL v1 — STARTING');
  info('MAIN', '═══════════════════════════════════════');

  const domains = parseDomains(inspectorConfig.input);
  info('MAIN', `Loaded ${domains.length} unique domains for inspection.`);

  if (domains.length === 0) {
    warn('MAIN', 'No domains to process. Exiting.');
    return;
  }

  let browser;
  try {
    browser = await launchInspectorBrowser();
  } catch (err) {
    logError('MAIN', `Failed to launch browser: ${err.message}`);
    process.exit(1);
  }

  try {
    await runInspectionPool(browser, domains);
  } finally {
    await closeBrowser(browser);
  }

  info('MAIN', '═══════════════════════════════════════');
  info('MAIN', '  INSPECTOR-GENERAL v1 — COMPLETE');
  info('MAIN', '═══════════════════════════════════════');
}

main().catch((err) => logError('MAIN', `Unhandled exception: ${err.message}`));
