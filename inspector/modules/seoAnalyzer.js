// INSPECTOR-GENERAL v1 — SEO Analyzer
// Checks for critical SEO elements using Cheerio.

import * as cheerio from 'cheerio';

/**
 * Analyze HTML for SEO issues.
 * @param {string} html
 * @param {string} url
 * @returns {object} SEO analysis results
 */
export function analyzeSEO(html, url) {
  const $ = cheerio.load(html);
  const issues = [];

  // ── Title Tag ──
  const title = $('title').text().trim();
  if (!title) {
    issues.push({
      type: 'missing_title',
      severity: 'critical',
      impact: 'Page will show URL instead of title in search results',
    });
  } else if (title.length < 10) {
    issues.push({
      type: 'short_title',
      severity: 'medium',
      impact: 'Title too short — may not attract clicks',
      detail: `Title: "${title}" (${title.length} chars)`,
    });
  } else if (title.length > 60) {
    issues.push({
      type: 'long_title',
      severity: 'low',
      impact: 'Title may be truncated in search results',
      detail: `Title: ${title.length} chars (recommended: 50-60)`,
    });
  }

  // ── Meta Description ──
  const metaDesc = $('meta[name="description"]').attr('content');
  if (!metaDesc) {
    issues.push({
      type: 'missing_meta_description',
      severity: 'high',
      impact: 'Lower CTR from search engines — Google will auto-generate snippet',
    });
  } else if (metaDesc.length < 50) {
    issues.push({
      type: 'short_meta_description',
      severity: 'medium',
      impact: 'Meta description too short — underutilizing SERP real estate',
      detail: `${metaDesc.length} chars (recommended: 150-160)`,
    });
  }

  // ── Canonical Tag ──
  const canonical = $('link[rel="canonical"]').attr('href');
  if (!canonical) {
    issues.push({
      type: 'missing_canonical',
      severity: 'high',
      impact: 'Risk of duplicate content issues across URL variations',
    });
  }

  // ── Viewport Tag ──
  const viewport = $('meta[name="viewport"]').attr('content');
  if (!viewport) {
    issues.push({
      type: 'missing_viewport',
      severity: 'critical',
      impact: 'Page will not render correctly on mobile devices',
    });
  }

  // ── Robots Meta ──
  const robots = $('meta[name="robots"]').attr('content');
  const hasRobots = !!robots;

  // ── JSON-LD Schema ──
  const jsonLdScripts = $('script[type="application/ld+json"]');
  if (jsonLdScripts.length === 0) {
    issues.push({
      type: 'missing_json_ld',
      severity: 'medium',
      impact: 'No structured data — missing potential rich snippets in search results',
    });
  }

  // ── Open Graph ──
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (!ogTitle) {
    issues.push({
      type: 'missing_og_tags',
      severity: 'low',
      impact: 'Social media shares will not display optimized previews',
    });
  }

  // ── Favicon ──
  const favicon = $('link[rel="icon"], link[rel="shortcut icon"]');
  if (favicon.length === 0) {
    issues.push({
      type: 'missing_favicon',
      severity: 'low',
      impact: 'No favicon — looks unprofessional in browser tabs and bookmarks',
    });
  }

  // ── Language attribute ──
  const lang = $('html').attr('lang');
  if (!lang) {
    issues.push({
      type: 'missing_lang_attribute',
      severity: 'medium',
      impact: 'Screen readers and search engines cannot determine page language',
    });
  }

  return {
    title: title || null,
    metaDescription: metaDesc || null,
    canonical: canonical || null,
    viewport: viewport || null,
    robots: robots || null,
    hasJsonLd: jsonLdScripts.length > 0,
    jsonLdCount: jsonLdScripts.length,
    ogTitle: ogTitle || null,
    ogImage: ogImage || null,
    lang: lang || null,
    issues,
  };
}
