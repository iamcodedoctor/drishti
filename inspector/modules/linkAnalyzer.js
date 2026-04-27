// INSPECTOR-GENERAL v1 — Link Analyzer
// Categorizes internal vs external links and checks for broken links.

import * as cheerio from 'cheerio';
import { debug } from '../core/logger.js';
import inspectorConfig from '../config.js';

/**
 * Analyze links in HTML — internal vs external, broken link detection.
 * @param {string} html
 * @param {string} baseUrl - The page URL for resolving relative links
 * @param {string} domain
 * @returns {Promise<object>} Link analysis results
 */
export async function analyzeLinks(html, baseUrl, domain) {
  const $ = cheerio.load(html);
  const issues = [];

  let baseDomain;
  try {
    baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '');
  } catch {
    baseDomain = domain.replace(/^www\./, '');
  }

  const internal = [];
  const external = [];
  const broken = [];

  const anchors = $('a[href]');
  const hrefs = new Set();

  anchors.each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // Skip non-http links
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      return;
    }

    // Resolve relative URLs
    let fullUrl;
    try {
      fullUrl = new URL(href, baseUrl).href;
    } catch {
      return;
    }

    // Deduplicate
    if (hrefs.has(fullUrl)) return;
    hrefs.add(fullUrl);

    // Classify
    try {
      const linkDomain = new URL(fullUrl).hostname.replace(/^www\./, '');
      if (linkDomain === baseDomain) {
        internal.push(fullUrl);
      } else {
        external.push(fullUrl);
      }
    } catch {
      external.push(fullUrl);
    }
  });

  // Check a sample of links for broken (HEAD requests) — max 10 to stay fast
  const linksToCheck = [...internal.slice(0, 5), ...external.slice(0, 5)];

  for (const link of linksToCheck) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), inspectorConfig.linkCheckTimeout);

      const res = await fetch(link, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; InspectorBot/1.0)',
        },
      });

      clearTimeout(timeout);

      if (res.status >= 400) {
        broken.push({ url: link, status: res.status });
      }
    } catch {
      broken.push({ url: link, status: 'timeout/error' });
    }
  }

  if (broken.length > 0) {
    issues.push({
      type: 'broken_links',
      severity: 'high',
      impact: `${broken.length} broken links detected (out of ${linksToCheck.length} checked)`,
      detail: broken.map((b) => `${b.url} → ${b.status}`).join('\n'),
    });
  }

  debug(domain, `Links: ${internal.length} internal | ${external.length} external | ${broken.length} broken`);

  return {
    internal: { count: internal.length, sample: internal.slice(0, 10) },
    external: { count: external.length, sample: external.slice(0, 10) },
    broken,
    issues,
  };
}
