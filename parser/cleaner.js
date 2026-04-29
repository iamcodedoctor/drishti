// DRISHTI v1 — Result Cleaner
// Post-processing pipeline:
// 1. Read raw_results.txt
// 2. Load blacklist: default list + project blacklist.txt (union, never replaces)
// 3. Resolve Bing tracking URLs
// 4. Filter junk + blacklisted domains
// 5. Keep only root URLs (strip article/blog paths under the host)
// 6. Deduplicate by URL, then one row per domain (last occurrence wins)
// 7. Write cleaned_results.txt
//
// Usage: node parser/cleaner.js [--output <dir>]
//         node parser/cleaner.js --project <name> [--tmp-run]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveUrl } from './resolver.js';
import { finalizeCleanedRows, renumberByKeywordEngine } from './cleanedPolicy.js';
import config, { applyProjectByName, applyTmpResultPaths } from '../config.js';

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

// ─── Parse CLI: --output | --project [--tmp-run] ──────
function parseCleanerArgs() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--output');
  const projIdx = args.indexOf('--project');
  const tmpRun = args.includes('--tmp-run');

  if (outIdx !== -1 && args[outIdx + 1] && projIdx !== -1 && args[projIdx + 1]) {
    console.error('Error: use either --output or --project, not both.');
    process.exit(1);
  }

  if (projIdx !== -1 && args[projIdx + 1]) {
    const name = args[projIdx + 1];
    if (!PROJECT_NAME_RE.test(name)) {
      console.error('Error: invalid --project name.');
      process.exit(1);
    }
    applyProjectByName(name);
    if (tmpRun) {
      applyTmpResultPaths();
    }
    return;
  }

  if (outIdx !== -1 && args[outIdx + 1]) {
    const dir = args[outIdx + 1];
    mkdirSync(dir, { recursive: true });
    config.paths.dataDir = dir;
    config.paths.rawResults = join(dir, 'raw_results.txt');
    config.paths.cleanedResults = join(dir, 'cleaned_results.txt');
    if (tmpRun) {
      console.error('--tmp-run requires --project');
      process.exit(1);
    }
    return;
  }

  if (tmpRun) {
    console.error('--tmp-run requires --project');
    process.exit(1);
  }
}

// ─── Load blacklist from file ─────────────────────────
function readDomainList(path) {
  const domains = new Set();
  try {
    if (!path || !existsSync(path)) {
      return domains;
    }

    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'));

    for (const domain of lines) {
      domains.add(domain);
      // Also add/remove www. variant for convenience
      if (domain.startsWith('www.')) {
        domains.add(domain.slice(4));
      } else {
        domains.add('www.' + domain);
      }
    }

    return domains;
  } catch {
    return domains;
  }
}

// ─── Load blacklist from default + project files ──────
/** Merges default (Tranco, etc.) and project `blacklist.txt` into one set — both apply. */
function loadBlacklist() {
  const merged = new Set();
  const defaultSet = readDomainList(config.paths.defaultBlacklist);
  const projectSet = readDomainList(config.paths.blacklist);

  for (const d of defaultSet) merged.add(d);
  for (const d of projectSet) merged.add(d);

  return {
    merged,
    defaultCount: defaultSet.size,
    projectCount: projectSet.size,
  };
}

/**
 * True if hostname is blocked by any blacklist entry.
 * Entries are hostnames (e.g. acme.com, www.acme.com). Matching rules:
 * - Exact match, or
 * - Host is a subdomain of an entry (test.acme.com matches rule acme.com).
 * Does not match different public suffixes (acme.in is not blocked by acme.com).
 * evilacme.com is not blocked by acme.com (not a subdomain boundary).
 */
function hostnameMatchesBlacklist(host, blacklistSet) {
  const h = String(host || '').toLowerCase();
  if (!h || blacklistSet.size === 0) return false;
  if (blacklistSet.has(h)) return true;
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return false;
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (blacklistSet.has(candidate)) return true;
  }
  return false;
}

// ─── Built-in junk domains ───────────────────────────
const BUILTIN_JUNK = new Set([
  'www.bing.com',
  'bing.com',
  'duckduckgo.com',
  'www.google.com',
  'google.com',
  'translate.google.com',
  'webcache.googleusercontent.com',
  'accounts.google.com',
  'support.google.com',
  'play.google.com',
  'maps.google.com',
]);

// URL patterns to exclude
const JUNK_URL_PATTERNS = [
  /\/ck\/a\?/,
  /microsoft\.com\/ck/,
  /go\.microsoft\.com/,
  /doubleclick\.net/,
  /googleadservices/,
  /googlesyndication/,
  /facebook\.com\/login/,
  /twitter\.com\/intent/,
  /linkedin\.com\/login/,
];

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isJunk(url, domain, blacklist) {
  if (BUILTIN_JUNK.has(domain)) return true;
  if (hostnameMatchesBlacklist(domain, blacklist)) return true;
  for (const pattern of JUNK_URL_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

function parseLine(line) {
  const match = line.match(/^\[(\w+)\]\s+(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
  if (!match) return null;
  return {
    engine: match[1],
    keyword: match[2].trim(),
    position: parseInt(match[3], 10),
    domain: match[4].trim(),
    url: match[5].trim(),
  };
}

// ─── Main Cleaning Pipeline ───────────────────────────
function clean() {
  parseCleanerArgs();

  console.log('═══════════════════════════════════════');
  console.log('  DRISHTI v1 — Result Cleaner');
  console.log('═══════════════════════════════════════\n');

  // Load blacklist
  const { merged: blacklist, defaultCount, projectCount } = loadBlacklist();
  if (blacklist.size > 0) {
    console.log(
      `[BLACKLIST] ${blacklist.size} host rules (default file=${defaultCount} + project file=${projectCount}, merged union)`,
    );
  } else {
    console.log('[BLACKLIST] No default/project blacklist found or both empty — skipping');
  }

  // Read raw results
  let rawContent;
  try {
    rawContent = readFileSync(config.paths.rawResults, 'utf-8');
  } catch (err) {
    console.error(`[ERROR] Cannot read ${config.paths.rawResults}: ${err.message}`);
    process.exit(1);
  }

  const lines = rawContent.split('\n').filter((l) => l.trim());
  console.log(`[INPUT]  ${lines.length} raw result lines from ${config.paths.rawResults}`);

  // Parse
  const parsed = [];
  let parseErrors = 0;
  for (const line of lines) {
    const result = parseLine(line);
    if (result) parsed.push(result);
    else parseErrors++;
  }
  if (parseErrors > 0) console.log(`[WARN]   ${parseErrors} lines could not be parsed`);
  console.log(`[PARSED] ${parsed.length} results parsed`);

  // Resolve Bing URLs
  let resolved = 0;
  for (const result of parsed) {
    const original = result.url;
    result.url = resolveUrl(result.url);
    result.domain = extractDomain(result.url);
    if (result.url !== original) resolved++;
  }
  console.log(`[RESOLVE] ${resolved} Bing tracking URLs resolved`);

  // Filter junk + blacklisted
  let blacklisted = 0;
  let junkFiltered = 0;
  const filtered = parsed.filter((r) => {
    if (!r.url || !r.domain) { junkFiltered++; return false; }
    if (!r.url.startsWith('http')) { junkFiltered++; return false; }
    if (hostnameMatchesBlacklist(r.domain, blacklist)) { blacklisted++; return false; }
    if (isJunk(r.url, r.domain, blacklist)) { junkFiltered++; return false; }
    return true;
  });
  console.log(`[FILTER] ${blacklisted} blacklisted domains removed`);
  console.log(`[FILTER] ${junkFiltered} junk results removed`);

  const stats = finalizeCleanedRows(filtered);
  if (stats.pathDropped > 0) {
    console.log(`[FILTER] ${stats.pathDropped} non-root URLs removed (article/blog paths)`);
  }
  if (stats.urlDropped > 0) {
    console.log(`[DEDUP]  ${stats.urlDropped} duplicate URLs removed`);
  }
  if (stats.domainDropped > 0) {
    console.log(`[DEDUP]  ${stats.domainDropped} duplicate domains removed (kept last row per host)`);
  }

  const final = renumberByKeywordEngine(stats.final);

  // Write output
  const outputLines = final.map(
    (r) => `[${r.engine}] ${r.keyword} | ${r.position} | ${r.domain} | ${r.url}`
  );

  try {
    mkdirSync(dirname(config.paths.cleanedResults), { recursive: true });
    writeFileSync(config.paths.cleanedResults, outputLines.join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.error(`[ERROR] Cannot write ${config.paths.cleanedResults}: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n[OUTPUT] ${final.length} cleaned results → ${config.paths.cleanedResults}`);

  const engines = [...new Set(final.map((r) => r.engine))];
  const keywords = [...new Set(final.map((r) => r.keyword))];
  const domains = [...new Set(final.map((r) => r.domain))];

  console.log('\n── Summary ──────────────────────────');
  console.log(`  Engines:  ${engines.join(', ') || 'none'}`);
  console.log(`  Keywords: ${keywords.length}`);
  console.log(`  Results:  ${final.length}`);
  console.log(`  Unique domains: ${domains.length}`);
  console.log('─────────────────────────────────────\n');
}

clean();
