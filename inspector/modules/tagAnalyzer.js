// INSPECTOR-GENERAL v1 — Tag Analyzer
// Checks HTML tag structure for SEO best practices.

import * as cheerio from 'cheerio';

/**
 * Analyze HTML tags for SEO issues.
 * @param {string} html
 * @returns {object} Tag analysis results
 */
export function analyzeTags(html) {
  const $ = cheerio.load(html);
  const issues = [];

  // ── H1 Tags ──
  const h1s = $('h1');
  const h1Count = h1s.length;
  const h1Texts = [];
  h1s.each((_, el) => {
    const text = $(el).text().trim();
    if (text) h1Texts.push(text);
  });

  if (h1Count === 0) {
    issues.push({
      type: 'missing_h1',
      severity: 'high',
      impact: 'No H1 tag — search engines use H1 to understand page topic',
    });
  } else if (h1Count > 1) {
    issues.push({
      type: 'multiple_h1',
      severity: 'medium',
      impact: `${h1Count} H1 tags found — should have exactly 1 per page`,
      detail: h1Texts.join(' | '),
    });
  }

  // ── Heading hierarchy ──
  const h2Count = $('h2').length;
  const h3Count = $('h3').length;
  const h4Count = $('h4').length;

  // ── Images without alt ──
  const images = $('img');
  const totalImages = images.length;
  let missingAlt = 0;
  let emptyAlt = 0;

  images.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt === undefined || alt === null) {
      missingAlt++;
    } else if (alt.trim() === '') {
      emptyAlt++;
    }
  });

  if (missingAlt > 0) {
    issues.push({
      type: 'missing_alt_attributes',
      severity: 'high',
      impact: `${missingAlt}/${totalImages} images missing alt attribute — hurts accessibility and image SEO`,
    });
  }

  // ── Empty anchor text ──
  const anchors = $('a');
  let emptyAnchors = 0;
  let totalAnchors = anchors.length;

  anchors.each((_, el) => {
    const text = $(el).text().trim();
    const hasImage = $(el).find('img').length > 0;
    const ariaLabel = $(el).attr('aria-label');

    if (!text && !hasImage && !ariaLabel) {
      emptyAnchors++;
    }
  });

  if (emptyAnchors > 0) {
    issues.push({
      type: 'empty_anchor_text',
      severity: 'medium',
      impact: `${emptyAnchors} links with no text, image, or aria-label — bad for accessibility and SEO`,
    });
  }

  return {
    headings: {
      h1: { count: h1Count, texts: h1Texts },
      h2: h2Count,
      h3: h3Count,
      h4: h4Count,
    },
    images: {
      total: totalImages,
      missingAlt,
      emptyAlt,
    },
    anchors: {
      total: totalAnchors,
      emptyText: emptyAnchors,
    },
    issues,
  };
}
