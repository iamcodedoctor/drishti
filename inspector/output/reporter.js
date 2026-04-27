// INSPECTOR-GENERAL v1 — Report Writer
// Generates seo_report.json and performance.json per domain.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { info } from '../core/logger.js';

/**
 * Calculate a summary SEO score (0-100) based on issues.
 * @param {Array} issues - All issues from analyzers
 * @returns {number}
 */
function calculateScore(issues) {
  let score = 100;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical': score -= 15; break;
      case 'high':     score -= 10; break;
      case 'medium':   score -= 5;  break;
      case 'low':      score -= 2;  break;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Write performance.json to domain folder.
 */
export function writePerformance(outputDir, perfData, domain) {
  const filePath = join(outputDir, 'performance.json');
  try {
    writeFileSync(filePath, JSON.stringify(perfData, null, 2), 'utf-8');
    info(domain, `Written: performance.json`);
  } catch (err) {
    info(domain, `Failed to write performance.json: ${err.message}`);
  }
}

/**
 * Write the full SEO report.
 */
export function writeSEOReport(outputDir, { seoData, tagData, linkData, crawledPages }, domain) {
  // Merge all issues
  const allIssues = [
    ...(seoData?.issues || []),
    ...(tagData?.issues || []),
    ...(linkData?.issues || []),
  ];

  const score = calculateScore(allIssues);

  const report = {
    domain,
    generated_at: new Date().toISOString(),
    summary_score: score,

    seo: {
      title: seoData?.title || null,
      metaDescription: seoData?.metaDescription || null,
      canonical: seoData?.canonical || null,
      viewport: seoData?.viewport || null,
      robots: seoData?.robots || null,
      hasJsonLd: seoData?.hasJsonLd || false,
      lang: seoData?.lang || null,
    },

    tags: {
      headings: tagData?.headings || {},
      images: tagData?.images || {},
      anchors: tagData?.anchors || {},
    },

    links: {
      internal: linkData?.internal || { count: 0 },
      external: linkData?.external || { count: 0 },
      broken: linkData?.broken || [],
    },

    crawled_pages: crawledPages || 0,
    issues: allIssues,
  };

  const filePath = join(outputDir, 'seo_report.json');
  try {
    writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    info(domain, `Written: seo_report.json | Score: ${score}/100 | Issues: ${allIssues.length}`);
  } catch (err) {
    info(domain, `Failed to write seo_report.json: ${err.message}`);
  }

  return report;
}
