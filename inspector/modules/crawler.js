// INSPECTOR-GENERAL v1 — Basic Crawler
// Crawls homepage + up to 2 internal links. Shallow only.

import * as cheerio from 'cheerio';
import { info, debug, error as logError } from '../core/logger.js';
import inspectorConfig from '../config.js';

/**
 * Extract internal links from HTML.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]} Array of internal URLs
 */
function extractInternalLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  let baseDomain;
  try {
    baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '');
  } catch {
    return [];
  }

  const links = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    try {
      const fullUrl = new URL(href, baseUrl).href;
      const linkDomain = new URL(fullUrl).hostname.replace(/^www\./, '');

      if (linkDomain === baseDomain && fullUrl !== baseUrl) {
        // Skip common non-content pages
        if (
          !fullUrl.includes('/login') &&
          !fullUrl.includes('/signup') &&
          !fullUrl.includes('/cart') &&
          !fullUrl.includes('/checkout') &&
          !fullUrl.includes('/account') &&
          !fullUrl.includes('#')
        ) {
          links.add(fullUrl);
        }
      }
    } catch {}
  });

  return [...links];
}

/**
 * Fetch a page's HTML.
 */
async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), inspectorConfig.fetchTimeout);

  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });

  clearTimeout(timeout);
  return res.text();
}

/**
 * Basic crawl: homepage + up to 2 internal links.
 * Returns HTML content of all crawled pages.
 * @param {string} url - Homepage URL
 * @param {string} domain
 * @returns {Promise<Array<{ url: string, html: string }>>}
 */
export async function basicCrawl(url, domain) {
  const crawled = [];

  try {
    // 1. Crawl homepage
    const homeHtml = await fetchPage(url);
    crawled.push({ url, html: homeHtml });
    debug(domain, `Crawled: ${url} (${homeHtml.length} chars)`);

    // 2. Find internal links
    const internalLinks = extractInternalLinks(homeHtml, url);
    const toCrawl = internalLinks.slice(0, inspectorConfig.maxInternalLinks);

    // 3. Crawl internal pages
    for (const link of toCrawl) {
      try {
        const pageHtml = await fetchPage(link);
        crawled.push({ url: link, html: pageHtml });
        debug(domain, `Crawled: ${link} (${pageHtml.length} chars)`);
      } catch (err) {
        debug(domain, `Failed to crawl ${link}: ${err.message}`);
      }
    }

    info(domain, `Crawled ${crawled.length} pages (homepage + ${crawled.length - 1} internal)`);
  } catch (err) {
    logError(domain, `Crawl failed: ${err.message}`);
  }

  return crawled;
}
