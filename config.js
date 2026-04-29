// DRISHTI v1 — Configuration
// All tunable parameters live here. No magic numbers elsewhere.
//
// Pagination: scrape.config.json sets maxPages (extract) and offset (pages/batches to skip without extracting).
// Null perEngine values inherit maxPages.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadScrapeConfig() {
  const path = join(__dirname, 'scrape.config.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function applyScrapePagination(engines, scrape) {
  if (!scrape || typeof scrape !== 'object') return;

  const globalMax = scrape.maxPages;
  const per = scrape.perEngine || {};

  for (const name of Object.keys(engines)) {
    const override = per[name];
    if (typeof override === 'number' && override >= 1) {
      engines[name].maxPages = Math.floor(override);
    } else if (override && typeof override === 'object' && typeof override.maxPages === 'number' && override.maxPages >= 1) {
      engines[name].maxPages = Math.floor(override.maxPages);
    } else if (typeof globalMax === 'number' && globalMax >= 1) {
      engines[name].maxPages = Math.floor(globalMax);
    }
    if (override && typeof override === 'object' && typeof override.offset === 'number' && override.offset >= 0) {
      engines[name].offset = Math.floor(override.offset);
    }
  }
}

function applyEnvOverrides(engines, env = process.env) {
  const defs = [
    ['bing', 'DRISHTI_BING_MAX_PAGES', 'DRISHTI_BING_OFFSET'],
    ['duckduckgo', 'DRISHTI_DDG_MAX_PAGES', 'DRISHTI_DDG_OFFSET'],
    ['google', 'DRISHTI_GOOGLE_MAX_PAGES', 'DRISHTI_GOOGLE_OFFSET'],
  ];
  for (const [name, maxKey, offKey] of defs) {
    const maxRaw = Number(env[maxKey]);
    if (Number.isFinite(maxRaw) && maxRaw >= 1) {
      engines[name].maxPages = Math.floor(maxRaw);
    }
    const offRaw = Number(env[offKey]);
    if (Number.isFinite(offRaw) && offRaw >= 0) {
      engines[name].offset = Math.floor(offRaw);
    }
  }
}

const config = {
  engines: {
    bing: {
      maxQueries: 100,
      maxPages: 5,
      /** Result pages to open without extracting, then scrape maxPages pages (e.g. offset 2 + pages 3 → SERP 3–5). */
      offset: 0,
      headless: false,
      delay: { min: 800, max: 2000 },
      keystrokeDelay: { min: 30, max: 80 },
      behavior: {
        humanType: false,
        randomMouse: false,
        randomScroll: false,
        idle: false,
      },
      searchUrl: 'https://www.bing.com/',
      searchInputSelector: '#sb_form_q',
      resultSelector: 'li.b_algo',
      titleSelector: 'h2 a',
      linkSelector: 'h2 a',
      snippetSelector: 'div.b_caption p, p.b_lineclamp2',
      nextPageSelector: 'a.sb_pagN',
    },

    duckduckgo: {
      maxQueries: 200,
      maxPages: 5,
      /** “More results” clicks to skip without extracting, then take maxPages batches. */
      offset: 0,
      headless: false,
      delay: { min: 300, max: 1000 },
      keystrokeDelay: { min: 20, max: 50 },
      behavior: {
        humanType: false,
        randomMouse: false,
        randomScroll: false,
        idle: false,
      },
      searchUrl: 'https://duckduckgo.com/',
      searchInputSelector: 'input[name="q"]',
      resultSelector: 'article[data-testid="result"]',
      titleSelector: 'a[data-testid="result-title-a"]',
      linkSelector: 'a[data-testid="result-title-a"]',
      snippetSelector: 'div[data-testid="result-snippet"]',
      moreResultsSelector: 'button#more-results',
    },

    google: {
      maxQueries: 80,
      maxPages: 5,
      /** SERP pages to visit (scroll/human) without extracting, after homepage search; then scrape maxPages pages. */
      offset: 0,
      headless: false,
      delay: { min: 1100, max: 2800 },
      keystrokeDelay: { min: 55, max: 140 },
      behavior: {
        humanType: true,
        randomMouse: true,
        randomScroll: true,
        idle: true,
        openRandomTabs: true,
      },
      searchUrl: 'https://www.google.com/',
      searchInputSelector: 'textarea[name="q"], input[name="q"]',
      resultSelector: 'div#rso div.g',
      titleSelector: 'h3',
      linkSelector: 'a:has(h3)',
      snippetSelector: '.VwiC3b, .yXK7nf, .IsZvec, .lEBKkf, span.st, div[data-sncf] span',
      nextPageSelector: 'a#pnnext',
    },
  },

  paths: {
    dataDir: './data',
    keywords: './data/keywords.txt',
    blacklist: './data/blacklist.txt',
    defaultBlacklist: './parser/default_blacklist_tranco_top10000.txt',
    rawResults: './data/raw_results.txt',
    cleanedResults: './data/cleaned_results.txt',
    logs: './data/logs.txt',
  },

  browser: {
    defaultViewport: { width: 1366, height: 768 },
    proxy: null,
    captchaTimeout: 120, // seconds to wait for manual CAPTCHA solve
  },
};

applyScrapePagination(config.engines, loadScrapeConfig());
applyEnvOverrides(config.engines);

/**
 * Absolute path to a project folder: <cwd>/data/<projectName>
 */
export function resolveProjectRoot(projectName, cwd = process.cwd()) {
  return join(cwd, 'data', projectName);
}

/**
 * Point all drishti paths at data/<projectName>/ (keywords, blacklist, raw, cleaned, logs).
 */
export function applyProjectByName(projectName, cwd = process.cwd()) {
  const root = resolveProjectRoot(projectName, cwd);
  mkdirSync(root, { recursive: true });
  config.paths.dataDir = root;
  config.paths.keywords = join(root, 'keywords.txt');
  config.paths.blacklist = join(root, 'blacklist.txt');
  config.paths.rawResults = join(root, 'raw_results.txt');
  config.paths.cleanedResults = join(root, 'cleaned_results.txt');
  config.paths.logs = join(root, 'logs.txt');
}

/**
 * After applyProjectByName: write SERP outputs to tmp_* files instead of canonical names.
 */
export function applyTmpResultPaths() {
  const d = config.paths.dataDir;
  config.paths.rawResults = join(d, 'tmp_raw_results.txt');
  config.paths.cleanedResults = join(d, 'tmp_cleaned_results.txt');
  config.paths.logs = join(d, 'tmp_logs.txt');
}

export default config;
