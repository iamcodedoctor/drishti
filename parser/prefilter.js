// DRISHTI v1 — Prefilter (FAST KILL ENGINE)
// Fast triage for domains:
// - Read cleaned_domains.txt (or generate from cleaned_results.txt)
// - DNS resolve
// - HTTP GET (no JS) and extract a few key HTML signals
// - Output prefilter.txt with one markdown link per domain + one JSON line
//
// Usage:
//   node parser/prefilter.js --project <name>
//   (optional) set DRISHTI_PREFILTER_CONCURRENCY, DRISHTI_PREFILTER_HTTP_TIMEOUT_MS

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dns from 'node:dns/promises';
import * as cheerio from 'cheerio';

import config from '../config.js';
import { resolveProjectRoot } from '../config.js';
import { info, warn, error as logError } from '../core/logger.js';

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const DEFAULT_CONCURRENCY = 3;
const CONCURRENCY = Number(process.env.DRISHTI_PREFILTER_CONCURRENCY ?? DEFAULT_CONCURRENCY);
const HTTP_TIMEOUT_MS = Number(process.env.DRISHTI_PREFILTER_HTTP_TIMEOUT_MS ?? 9000);
const INDEXED_CHECK_TIMEOUT_MS = Number(process.env.DRISHTI_PREFILTER_INDEXED_TIMEOUT_MS ?? 7000);
const MIN_PRESCORE = Number(process.env.DRISHTI_PREFILTER_MIN_PRESCORE ?? 30);

const LARGE_BRANDS = new Set([
  // Very large "brand" domains (often low-lead value). Keep list conservative.
  'google.com',
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'linkedin.com',
  'wikipedia.org',
  'amazon.com',
  'microsoft.com',
  'apple.com',
  'netflix.com',
  'github.com',
  'gitlab.com',
  'reddit.com',
]);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDomain(d) {
  const x = String(d || '').trim().toLowerCase();
  if (!x) return '';
  // DNS and HTTP resolution are fine either way, but inspector matching benefits from stable keys.
  return x.startsWith('www.') ? x.slice(4) : x;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const projIdx = args.indexOf('--project');
  const projectName = projIdx !== -1 && args[projIdx + 1] ? args[projIdx + 1] : '';
  if (process.env.GHOST_PROJECT_DIR) {
    // server passes this to pin file paths reliably.
    return { projectRoot: process.env.GHOST_PROJECT_DIR };
  }
  if (!projectName || !PROJECT_NAME_RE.test(projectName)) {
    throw new Error('Usage: node parser/prefilter.js --project <name>');
  }
  const projectRoot = resolveProjectRoot(projectName, process.cwd());
  return { projectRoot };
}

function setConfigPathsFromRoot(projectRoot) {
  config.paths.dataDir = projectRoot;
  config.paths.keywords = join(projectRoot, 'keywords.txt');
  config.paths.blacklist = join(projectRoot, 'blacklist.txt');
  config.paths.rawResults = join(projectRoot, 'raw_results.txt');
  config.paths.cleanedResults = join(projectRoot, 'cleaned_results.txt');
  config.paths.logs = join(projectRoot, 'logs.txt');
}

function loadCleanedDomains(cleanedDomainsPath, cleanedResultsPath) {
  if (existsSync(cleanedDomainsPath)) {
    const raw = readFileSync(cleanedDomainsPath, 'utf-8');
    const domains = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(normalizeDomain);
    return [...new Set(domains)].sort();
  }

  if (!existsSync(cleanedResultsPath)) {
    throw new Error(
      `Missing ${cleanedDomainsPath} and ${cleanedResultsPath}. Run "Deduplication and clean" first.`,
    );
  }

  const raw = readFileSync(cleanedResultsPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const domainSet = new Set();
  for (const line of lines) {
    const match = line.match(/^\[(\w+)\]\s+(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
    if (!match) continue;
    domainSet.add(normalizeDomain(match[4]));
  }
  const domains = [...domainSet].filter(Boolean).sort();
  // Pre-create for transparency + future pipeline stages.
  writeFileSync(cleanedDomainsPath, domains.join('\n') + (domains.length ? '\n' : ''), 'utf-8');
  return domains;
}

async function dnsResolve(domain) {
  try {
    await dns.resolve4(domain);
    return true;
  } catch {
    /* try v6 */
  }
  try {
    await dns.resolve6(domain);
    return true;
  } catch {
    return false;
  }
}

async function fetchHomepage(url, domain) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    const tFetchDone = Date.now();
    const ttfbMs = tFetchDone - t0;
    const html = await res.text();
    const totalMs = Date.now() - t0;
    return { ok: res.ok, statusCode: res.status, html, ttfbMs, totalMs, finalUrl: res.url || url };
  } finally {
    clearTimeout(timeout);
  }
}

function detectCdn(html) {
  const h = String(html || '').toLowerCase();
  // Rough CDN signal detection (no external libs; deterministic heuristic).
  const cdnSignals = [
    'cloudflare',
    'cloudfront',
    'fastly',
    'akamai',
    'jsdelivr',
    'stackpath.bootstrapcdn.com',
    'maxcdn',
    'stackpath',
    'cdn.jsdelivr.net',
    'cdn.shopify.com',
    's3.amazonaws.com',
    'googleusercontent.com',
    'edgekey',
  ];
  return cdnSignals.some((s) => h.includes(s));
}

function detectTechBooleans(html, title, metaDescription) {
  const h = String(html || '');
  const t = String(title || '').toLowerCase();
  const md = String(metaDescription || '').toLowerCase();

  const uses_wordpress =
    /wp-content|wordpress/i.test(h) || /powered by wordpress/i.test(t) || /wordpress/i.test(md);
  const uses_wix = /wixstatic|wix\.com/i.test(h) || /wix/i.test(t) || /wix/i.test(md);
  const uses_shopify = /shopify/i.test(h) || /cdn\.shopify\.com/i.test(h) || /shopify/i.test(t);

  const no_cdn_detected = !detectCdn(h);

  let tech_label = 'unknown';
  if (uses_wordpress) tech_label = 'wordpress';
  else if (uses_wix) tech_label = 'wix';
  else if (uses_shopify) tech_label = 'shopify';
  else if (/squarespace/i.test(h) || /squarespace/i.test(t)) tech_label = 'squarespace';
  else if (/drupal-settings-json/i.test(h) || /drupal/i.test(t)) tech_label = 'drupal';
  else if (/next\.js/i.test(h) || /__NEXT_DATA__/i.test(h)) tech_label = 'nextjs';
  else if (/react/i.test(h) && /_next/i.test(h)) tech_label = 'react';
  else if (/bootstrap/i.test(h)) tech_label = 'bootstrap';

  return { uses_wordpress, uses_wix, uses_shopify, no_cdn_detected, tech_label };
}

function extractSignals(html) {
  const $ = cheerio.load(String(html || ''));
  const title = ($('title').first().text() || '').trim();
  const metaDescription = ($('meta[name="description"]').attr('content') || '').trim();
  const h1 = ($('h1').first().text() || '').trim();

  // Quick extraction: body text, normalized whitespace, then first 500 words.
  const bodyText = ($('body').text() || '').replace(/\s+/g, ' ').trim();
  const words = bodyText ? bodyText.split(' ').filter(Boolean) : [];
  const words500Arr = words.slice(0, 500);
  const words500 = words500Arr.join(' ');
  const wordCount = words.length;
  const snippet = words500;

  return { title, metaDescription, h1, wordCount, words500, snippet };
}

async function checkIndexed(domain) {
  // Best-effort (no API). If blocked, return null and mark in flags.
  const q = `site:${domain}`;
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXED_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return { indexed: null, reason: `http_${res.status}` };
    const html = await res.text();
    const normalized = domain.replace(/^www\./, '').toLowerCase();
    if (/captcha|unusual traffic|type the characters/i.test(html)) return { indexed: null, reason: 'captcha' };

    // Require a real outbound href to the domain to avoid matching the query input alone.
    const hrefRe = new RegExp(`href="https?:\\/\\/[^"]*${escapeRegExp(normalized)}[\\/"\\?]`, 'i');
    const indexed = hrefRe.test(html) || html.toLowerCase().includes(`https://${normalized}/`);
    return { indexed: !!indexed };
  } catch (e) {
    return { indexed: null, reason: 'timeout_or_fetch_fail' };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeForDuplicate(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function computePreScoreDeterministic({
  title,
  metaDescription,
  h1,
  content_length_words,
  duplicate_title_meta,
  uses_wordpress,
  uses_wix,
  uses_shopify,
  no_cdn_detected,
  ttfbMs,
  total_response_time_ms,
  seoFlags,
  internal_links,
  external_links,
}) {
  // This mirrors the user-provided Stage-1 formula.
  const flags = [];
  let pre_score = 0;

  // 1) CONTENT SCORE (Max: 40)
  let content_score = 0;
  if (title) content_score += 10;
  else flags.push('missing_title');
  if (metaDescription) content_score += 10;
  else flags.push('missing_meta');
  if (h1) content_score += 10;
  else flags.push('missing_h1');
  if (content_length_words >= 300) content_score += 10;
  else flags.push('low_content');
  pre_score += content_score;

  // 2) CONTENT QUALITY SCORE (Max: 10)
  let content_quality_score = 0;
  if (content_length_words < 100) {
    content_quality_score += 5;
    flags.push('thin_content');
  }
  if (duplicate_title_meta) {
    content_quality_score += 5;
    flags.push('duplicate_meta');
  }
  pre_score += content_quality_score;

  // 3) TECH STACK SCORE (Max: 20)
  let tech_score = 0;
  if (uses_wordpress) tech_score += 10;
  if (uses_wix) tech_score += 15;
  if (uses_shopify) tech_score += 8;
  if (no_cdn_detected) {
    tech_score += 5;
    flags.push('no_cdn');
  }
  pre_score += tech_score;

  // 4) PERFORMANCE SCORE (Max: 20)
  let performance_score = 0;
  if (ttfbMs > 1500) {
    performance_score += 10;
    flags.push('slow_ttfb');
  }
  if (total_response_time_ms > 3000) {
    performance_score += 10;
    flags.push('slow_response');
  }
  pre_score += performance_score;

  // 5) SEO STRUCTURE SCORE (Max: 25)
  let seo_structure_score = 0;
  if (!seoFlags.has_canonical) {
    seo_structure_score += 5;
    flags.push('missing_canonical');
  }
  if (!seoFlags.has_viewport) {
    seo_structure_score += 5;
    flags.push('missing_viewport');
  }
  if (!seoFlags.has_lang) {
    seo_structure_score += 5;
    flags.push('missing_lang');
  }
  if (!seoFlags.has_favicon) {
    seo_structure_score += 5;
    flags.push('missing_favicon');
  }
  if (!seoFlags.has_open_graph) {
    seo_structure_score += 5;
    flags.push('missing_og');
  }
  pre_score += seo_structure_score;

  // 6) LINK SCORE (Max: 15)
  let link_score = 0;
  if (internal_links < 5) {
    link_score += 10;
    flags.push('low_internal_links');
  }
  if (external_links === 0) {
    link_score += 5;
    flags.push('no_external_links');
  }
  pre_score += link_score;

  pre_score = Math.min(100, Math.max(0, Math.round(pre_score)));
  return { pre_score, flags };
}

function detectSeoStructure(html) {
  const $ = cheerio.load(String(html || ''));
  const has_canonical = $('link[rel="canonical"][href]').length > 0;
  const has_viewport = $('meta[name="viewport"]').length > 0;
  const lang = $('html').attr('lang');
  const has_lang = typeof lang === 'string' && lang.trim().length > 0;
  const has_favicon = $('link[rel="icon"][href], link[rel="shortcut icon"][href]').length > 0;
  const has_open_graph = $('meta[property^="og:"]').length > 0;
  return { has_canonical, has_viewport, has_lang, has_favicon, has_open_graph };
}

function normalizeLinkForCounting(href) {
  // Keep counting stable: remove fragment; keep query.
  try {
    const u = new URL(href);
    u.hash = '';
    return u.href;
  } catch {
    return href;
  }
}

function countLinksInternalExternal(html, baseUrl, domain) {
  const $ = cheerio.load(String(html || ''));
  const internalHost = normalizeDomain(domain);
  const internal = new Set();
  const external = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const h = String(href).trim();
    if (!h) return;
    if (h.startsWith('#')) return;
    if (h.startsWith('mailto:') || h.startsWith('tel:')) return;
    if (h.startsWith('javascript:')) return;

    let abs;
    try {
      abs = new URL(h, baseUrl).href;
    } catch {
      return;
    }

    let host;
    try {
      host = new URL(abs).hostname.toLowerCase();
    } catch {
      return;
    }
    host = normalizeDomain(host);

    const norm = normalizeLinkForCounting(abs);
    if (host === internalHost) internal.add(norm);
    else external.add(norm);

    // Avoid unbounded sets for very link-heavy pages.
    if (internal.size > 60 && external.size > 60) return false;
    return undefined;
  });

  return { internal_links: internal.size, external_links: external.size };
}

async function prefilterDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;

  // Brand rejection: domain or title indicates common big brands.
  if (LARGE_BRANDS.has(normalized)) {
    return { reject: true, reason: 'large_brand_domain' };
  }

  const dnsOk = await dnsResolve(normalized);
  if (!dnsOk) return { reject: true, reason: 'dns_unresolved' };

  const homepageUrl = `https://${normalized}/`;
  let fetched;
  try {
    fetched = await fetchHomepage(homepageUrl, normalized);
  } catch (e) {
    return { reject: true, reason: 'http_fetch_failed' };
  }

  if (!fetched?.ok) {
    return { reject: true, reason: `http_not_ok_${fetched?.statusCode ?? 'unknown'}` };
  }

  const signals = extractSignals(fetched.html);
  if (!signals.wordCount || signals.wordCount < 80) {
    return { reject: true, reason: 'empty_or_too_little_content' };
  }

  const techInfo = detectTechBooleans(fetched.html, signals.title, signals.metaDescription);

  // "Obvious large brand" can also appear in title.
  const lcTitle = (signals.title || '').toLowerCase();
  if ([...LARGE_BRANDS].some((b) => b !== 'wikipedia.org' && lcTitle.includes(b.replace('.com', '')))) {
    return { reject: true, reason: 'large_brand_title' };
  }
  if (LARGE_BRANDS.has(normalized) || lcTitle.includes('wikipedia')) {
    return { reject: true, reason: 'large_brand_title' };
  }

  const seoFlags = detectSeoStructure(fetched.html);
  const links = countLinksInternalExternal(fetched.html, homepageUrl, normalized);
  const duplicate_title_meta =
    normalizeForDuplicate(signals.title) &&
    normalizeForDuplicate(signals.metaDescription) &&
    normalizeForDuplicate(signals.title) === normalizeForDuplicate(signals.metaDescription);

  const { pre_score, flags } = computePreScoreDeterministic({
    title: signals.title || '',
    metaDescription: signals.metaDescription || '',
    h1: signals.h1 || '',
    content_length_words: signals.wordCount,
    duplicate_title_meta,
    uses_wordpress: techInfo.uses_wordpress,
    uses_wix: techInfo.uses_wix,
    uses_shopify: techInfo.uses_shopify,
    no_cdn_detected: techInfo.no_cdn_detected,
    ttfbMs: fetched.ttfbMs,
    total_response_time_ms: fetched.totalMs,
    seoFlags,
    internal_links: links.internal_links,
    external_links: links.external_links,
  });

  // Deterministic rejection rule.
  if (pre_score < MIN_PRESCORE) {
    return { reject: true, reason: 'pre_score_below_threshold' };
  }

  return {
    reject: false,
    record: {
      domain: normalized,
      pre_score,
      content_snippet: signals.snippet,
      flags,
      tech: techInfo.tech_label,
      metrics: {
        content_length_words: signals.wordCount,
        ttfb_ms: fetched.ttfbMs,
        total_response_time_ms: fetched.totalMs,
        internal_links: links.internal_links,
        external_links: links.external_links,
        seo: seoFlags,
        tech: {
          uses_wordpress: techInfo.uses_wordpress,
          uses_wix: techInfo.uses_wix,
          uses_shopify: techInfo.uses_shopify,
          no_cdn_detected: techInfo.no_cdn_detected,
        },
        duplicate_title_meta,
      },
    },
  };
}

async function runWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async (_, i) => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx, i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const { projectRoot } = parseArgs();
  setConfigPathsFromRoot(projectRoot);

  const cleanedDomainsPath = join(projectRoot, 'cleaned_domains.txt');
  const prefilterPath = join(projectRoot, 'prefilter.txt');

  info('PREFILTER', `Starting. projectRoot=${projectRoot}`);
  info('PREFILTER', `Input: cleaned_domains.txt (or generate from cleaned_results.txt)`);

  const domains = loadCleanedDomains(cleanedDomainsPath, config.paths.cleanedResults);
  info('PREFILTER', `Loaded ${domains.length} unique domain(s)`);

  if (domains.length === 0) {
    warn('PREFILTER', 'No domains found. Exiting.');
    return;
  }

  const limit = Number.isFinite(CONCURRENCY) && CONCURRENCY >= 1 ? Math.floor(CONCURRENCY) : DEFAULT_CONCURRENCY;
  info('PREFILTER', `Concurrency: ${limit}`);

  const results = await runWithConcurrency(domains, limit, prefilterDomain);

  const accepted = [];
  const rejectedByReason = new Map();
  for (const r of results) {
    if (!r) continue;
    if (r.reject) continue;
    if (r.record) accepted.push(r.record);
  }

  // Rejections summary (helpful for debugging).
  for (const r of results) {
    if (!r?.reject) continue;
    const reason = String(r.reason || 'unknown_reason');
    rejectedByReason.set(reason, (rejectedByReason.get(reason) || 0) + 1);
  }

  accepted.sort((a, b) => (b.pre_score || 0) - (a.pre_score || 0));

  // Write markdown-style blocks (links + JSON).
  const blocks = [];
  for (const rec of accepted) {
    const link = `[${rec.domain}](https://${rec.domain})`;
    blocks.push(link);
    blocks.push(JSON.stringify(rec));
    blocks.push(''); // spacer
  }

  try {
    writeFileSync(prefilterPath, blocks.join('\n'), 'utf-8');
    info('PREFILTER', `Wrote ${accepted.length} domain(s) -> ${prefilterPath}`);
    if (accepted.length === 0) warn('PREFILTER', 'All domains rejected by prefilter.');
    if (rejectedByReason.size > 0) {
      const parts = [...rejectedByReason.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}=${v}`);
      info('PREFILTER', `Rejected breakdown: ${parts.join(', ')}`);
    }
  } catch (e) {
    logError('PREFILTER', `Failed to write ${prefilterPath}: ${e.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  logError('PREFILTER', `Fatal: ${e.message}`);
  process.exit(1);
});

