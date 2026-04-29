// DRISHTI — local web GUI (Express + SSE logs)

import express from 'express';
import {
  readdirSync,
  statSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  mergeTmpRawIntoCanonical,
  mergeTmpCleanedIntoCanonical,
  mergeTmpLogs,
} from './lib/mergeProjectResults.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = join(ROOT, 'data');
const SCRAPE_CONFIG_PATH = join(ROOT, 'scrape.config.json');

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
/** Legacy / global inspector output at repo root — not a user project. */
const HIDDEN_PROJECT_DIRS = new Set(['recon']);

const STEP_ORDER = ['bing', 'duckduckgo', 'google', 'clean', 'inspector'];

const SCRAPE_ENGINE_ENV = {
  bing: { maxPages: 'DRISHTI_BING_MAX_PAGES', offset: 'DRISHTI_BING_OFFSET' },
  duckduckgo: { maxPages: 'DRISHTI_DDG_MAX_PAGES', offset: 'DRISHTI_DDG_OFFSET' },
  google: { maxPages: 'DRISHTI_GOOGLE_MAX_PAGES', offset: 'DRISHTI_GOOGLE_OFFSET' },
};

const READABLE_FILES = new Set([
  'keywords.txt',
  'blacklist.txt',
  'raw_results.txt',
  'cleaned_results.txt',
  'logs.txt',
  'tmp_raw_results.txt',
  'tmp_cleaned_results.txt',
  'tmp_logs.txt',
]);

const EDITABLE_FILES = new Set(['keywords.txt', 'blacklist.txt']);

/** @type {Map<string, Set<import('http').ServerResponse>>} */
const streamClients = new Map();

/** @type {Map<string, { aborted: boolean, children: import('child_process').ChildProcess[], projectName?: string, steps?: string[], status?: string, startedAt?: number, updatedAt?: number, finishedAt?: number, message?: string }>} */
const activeRuns = new Map();

const IMAGE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
]);

const TEXT_VIEW_MAX = 4 * 1024 * 1024;
const DEFAULT_SCRAPE_SETTINGS = {
  maxPages: 2,
  perEngine: {},
};

function isRunAborted(runId) {
  return activeRuns.get(runId)?.aborted === true;
}

/**
 * Resolve a path strictly inside the project directory (no .. escape).
 * @param {string} projectName
 * @param {string} relPath posix-style relative path, e.g. "recon/foo.com/a.png"
 */
function safeProjectFile(projectName, relPath) {
  if (!PROJECT_NAME_RE.test(projectName)) throw new Error('Bad project');
  const base = resolve(projectPath(projectName));
  const raw = String(relPath || '').replace(/\\/g, '/');
  const segments = raw.split('/').filter((s) => s && s !== '.' && s !== '..');
  const child = resolve(base, ...segments);
  const baseWithSep = base.endsWith(sep) ? base : base + sep;
  if (child !== base && !child.startsWith(baseWithSep)) {
    throw new Error('Path escapes project');
  }
  return child;
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function mimeForExt(ext) {
  const m = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
  };
  return m[ext] || 'application/octet-stream';
}

function sanitizeScrapeSettings(input) {
  const safe = {
    maxPages: DEFAULT_SCRAPE_SETTINGS.maxPages,
    perEngine: {},
  };
  const src = input && typeof input === 'object' ? input : {};
  const clampPageCount = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    const v = Math.floor(x);
    if (v < 1) return null;
    return Math.min(v, 50);
  };
  const globalMax = clampPageCount(src.maxPages);
  if (globalMax) safe.maxPages = globalMax;

  const clampOffset = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const v = Math.floor(x);
    if (v < 0) return 0;
    return Math.min(v, 5000);
  };
  const per = src.perEngine && typeof src.perEngine === 'object' ? src.perEngine : {};
  for (const key of ['bing', 'duckduckgo', 'google']) {
    const raw = per[key];
    let maxPages = null;
    let offset = 0;

    if (typeof raw === 'number') {
      maxPages = clampPageCount(raw);
    } else if (raw && typeof raw === 'object') {
      maxPages = clampPageCount(raw.maxPages);
      offset = clampOffset(raw.offset);
    }

    safe.perEngine[key] = {
      offset,
    };
    if (maxPages) {
      safe.perEngine[key].maxPages = maxPages;
    }
  }
  return safe;
}

function readScrapeSettings() {
  try {
    const raw = readFileSync(SCRAPE_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return sanitizeScrapeSettings(parsed);
  } catch {
    return { ...DEFAULT_SCRAPE_SETTINGS, perEngine: {} };
  }
}

function writeScrapeSettings(settings) {
  const safe = sanitizeScrapeSettings(settings);
  writeFileSync(SCRAPE_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, 'utf-8');
  return safe;
}

function emitRunLog(runId, text) {
  const run = activeRuns.get(runId);
  if (run) run.updatedAt = Date.now();
  const set = streamClients.get(runId);
  if (!set?.size) return;
  const payload = JSON.stringify({ text });
  for (const res of set) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      set.delete(res);
    }
  }
}

function emitRunDone(runId, ok, message, extra = {}) {
  const run = activeRuns.get(runId);
  if (run) {
    run.status = extra.stopped ? 'stopped' : ok ? 'completed' : 'failed';
    run.finishedAt = Date.now();
    run.updatedAt = Date.now();
    run.message = message || '';
  }
  const set = streamClients.get(runId);
  if (!set?.size) return;
  const payload = JSON.stringify({
    done: true,
    ok,
    message: message || '',
    stopped: !!extra.stopped,
  });
  for (const res of set) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      set.delete(res);
    }
  }
}

function listProjects() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const names = [];
  for (const name of readdirSync(DATA_DIR)) {
    if (name.startsWith('.')) continue;
    if (HIDDEN_PROJECT_DIRS.has(name)) continue;
    const p = join(DATA_DIR, name);
    try {
      if (statSync(p).isDirectory()) names.push(name);
    } catch {
      /* skip */
    }
  }
  names.sort();
  return names;
}

function projectPath(name) {
  return join(DATA_DIR, name);
}

function registerRunChild(runId, child) {
  let entry = activeRuns.get(runId);
  if (!entry) {
    entry = { aborted: false, children: [] };
    activeRuns.set(runId, entry);
  }
  entry.children.push(child);
  child.on('close', () => {
    const e = activeRuns.get(runId);
    if (!e) return;
    const i = e.children.indexOf(child);
    if (i >= 0) e.children.splice(i, 1);
  });
}

function ensureTmpFiles(root) {
  const files = ['tmp_raw_results.txt', 'tmp_cleaned_results.txt', 'tmp_logs.txt'];
  for (const file of files) {
    const fp = join(root, file);
    if (!existsSync(fp)) {
      writeFileSync(fp, '', 'utf-8');
    }
  }
}

function appendKeywordsHistory(root, keywordsText, steps) {
  const raw = String(keywordsText || '');
  const cleaned = raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
  if (!cleaned.length) return;

  const historyPath = join(root, 'keywords_history.txt');
  const stamp = new Date().toISOString();
  const header = `\n=== ${stamp} | steps: ${steps.join(', ')} ===\n`;
  const body = cleaned.join('\n') + '\n';
  try {
    writeFileSync(historyPath, header + body, { encoding: 'utf-8', flag: 'a' });
  } catch {
    // non-fatal: history should not block a run
  }
}

function runCmd(runId, command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    if (isRunAborted(runId)) {
      reject(new Error('STOPPED'));
      return;
    }
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      shell: false,
    });
    registerRunChild(runId, child);
    const onChunk = (buf) => {
      const s = buf.toString();
      emitRunLog(runId, s);
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (isRunAborted(runId)) {
        reject(new Error('STOPPED'));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`Command exited with code ${code}${signal ? ` (${signal})` : ''}`));
    });
  });
}

async function executeReconJob(runId, projectName, steps, keywordsText, blacklistText, runConfig = {}) {
  activeRuns.set(runId, {
    aborted: false,
    children: [],
    projectName,
    steps: [...steps],
    status: 'running',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    message: '',
  });

  const root = projectPath(projectName);
  mkdirSync(root, { recursive: true });
  ensureTmpFiles(root);

  const sorted = STEP_ORDER.filter((s) => steps.includes(s));
  const scraping = sorted.filter((s) => s === 'bing' || s === 'duckduckgo' || s === 'google');
  const runClean = sorted.includes('clean');
  const runInspector = sorted.includes('inspector');
  const needsKeywords = scraping.length > 0 || runClean;
  const kwTrim = String(keywordsText).trim();

  if (needsKeywords) {
    if (!kwTrim) {
      throw new Error('Keywords cannot be empty for scrape/clean steps');
    }
    writeFileSync(join(root, 'keywords.txt'), keywordsText, 'utf-8');
    // Empty blacklist means "allow all"; cleaner handles missing/empty blacklist.
    if (String(blacklistText).trim()) {
      writeFileSync(join(root, 'blacklist.txt'), blacklistText, 'utf-8');
    } else {
      try {
        unlinkSync(join(root, 'blacklist.txt'));
      } catch {
        /* ignore */
      }
    }
    appendKeywordsHistory(root, keywordsText, sorted);
  } else if (runClean) {
    // Clean should proceed even if blacklist is empty/missing.
    if (String(blacklistText).trim()) {
      writeFileSync(join(root, 'blacklist.txt'), blacklistText, 'utf-8');
    } else {
      try {
        unlinkSync(join(root, 'blacklist.txt'));
      } catch {
        /* ignore */
      }
    }
  }
  // Inspector-only: do not overwrite keywords/blacklist from this form (use Save or existing files).

  if (sorted.length === 0) {
    throw new Error('No steps selected');
  }

  emitRunLog(runId, `[gui] Steps: ${sorted.join(' → ')}\n`);

  const useTmpSerp = scraping.length > 0 || runClean;
  if (scraping.length > 0) {
    try {
      unlinkSync(join(root, 'tmp_cleaned_results.txt'));
    } catch {
      /* none */
    }
  }

  let firstEngine = true;

  for (const eng of scraping) {
    if (isRunAborted(runId)) throw new Error('STOPPED');
    const args = ['main.js', '--engine', eng, '--project', projectName, '--tmp-run'];
    if (useTmpSerp && firstEngine) {
      args.push('--truncate-tmp');
    }
    const per = runConfig?.[eng] && typeof runConfig[eng] === 'object' ? runConfig[eng] : {};
    const envNames = SCRAPE_ENGINE_ENV[eng];
    const extraEnv = {};
    if (envNames && typeof per.maxPages === 'number' && per.maxPages >= 1) {
      extraEnv[envNames.maxPages] = String(Math.floor(per.maxPages));
    }
    if (envNames && typeof per.offset === 'number' && per.offset >= 0) {
      extraEnv[envNames.offset] = String(Math.floor(per.offset));
    }
    firstEngine = false;
    emitRunLog(runId, `\n[gui] ▶ node ${args.join(' ')}\n`);
    await runCmd(runId, process.execPath, args, extraEnv);
  }

  if (runClean) {
    if (isRunAborted(runId)) throw new Error('STOPPED');
    const args = ['parser/cleaner.js', '--project', projectName, '--tmp-run'];
    emitRunLog(runId, `\n[gui] ▶ node ${args.join(' ')}\n`);
    await runCmd(runId, process.execPath, args);
  }

  if (useTmpSerp && !isRunAborted(runId)) {
    emitRunLog(runId, '\n[gui] ▶ Merging tmp results into canonical files…\n');
    const rawM = mergeTmpRawIntoCanonical(root);
    if (!rawM.skipped) emitRunLog(runId, `[gui] raw_results: merged (+${rawM.added} new URLs)\n`);
    const clM = mergeTmpCleanedIntoCanonical(root);
    if (!clM.skipped) emitRunLog(runId, `[gui] cleaned_results: merged & normalized (${clM.rows} rows)\n`);
    if (existsSync(join(root, 'tmp_logs.txt'))) {
      mergeTmpLogs(root);
      emitRunLog(runId, '[gui] tmp_logs merged into logs.txt\n');
    }
  }

  if (runInspector && !isRunAborted(runId)) {
    emitRunLog(runId, `\n[gui] ▶ inspector (GHOST_PROJECT_DIR=${root})\n`);
    await runCmd(runId, process.execPath, ['inspector/main.js'], {
      GHOST_PROJECT_DIR: root,
    });
  }

  if (isRunAborted(runId)) throw new Error('STOPPED');
  emitRunLog(runId, '\n[gui] Done.\n');
}

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(join(ROOT, 'gui', 'public')));

app.get('/api/settings/scrape', (_req, res) => {
  try {
    res.json({ settings: readScrapeSettings() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/settings/scrape', (req, res) => {
  try {
    const settings = writeScrapeSettings(req.body || {});
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/runs', (req, res) => {
  try {
    const project = req.query.project ? String(req.query.project) : '';
    const runs = [];
    for (const [runId, entry] of activeRuns.entries()) {
      if (project && entry.projectName !== project) continue;
      runs.push({
        runId,
        projectName: entry.projectName || '',
        steps: entry.steps || [],
        status: entry.status || (entry.aborted ? 'stopped' : 'running'),
        startedAt: entry.startedAt || null,
        updatedAt: entry.updatedAt || null,
        finishedAt: entry.finishedAt || null,
        message: entry.message || '',
      });
    }
    runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    res.json({ runs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects', (_req, res) => {
  try {
    const projects = listProjects().map((name) => {
      const base = projectPath(name);
      return {
        name,
        hasKeywords: existsSync(join(base, 'keywords.txt')),
        hasBlacklist: existsSync(join(base, 'blacklist.txt')),
        hasRaw: existsSync(join(base, 'raw_results.txt')),
        hasCleaned: existsSync(join(base, 'cleaned_results.txt')),
      };
    });
    res.json({ projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects', (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!PROJECT_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid project name' });
  }
  if (HIDDEN_PROJECT_DIRS.has(name)) {
    return res.status(400).json({ error: 'Reserved project name' });
  }
  const dest = projectPath(name);
  if (existsSync(dest)) {
    return res.status(409).json({ error: 'Project already exists' });
  }
  try {
    mkdirSync(dest, { recursive: true });
    res.json({ ok: true, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:name/files', (req, res) => {
  const name = req.params.name;
  if (!PROJECT_NAME_RE.test(name)) return res.status(400).json({ error: 'Bad name' });
  const base = projectPath(name);
  if (!existsSync(base) || !statSync(base).isDirectory()) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const files = readdirSync(base).filter((f) => !f.startsWith('.'));
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:name/file/:filename', (req, res) => {
  const name = req.params.name;
  const filename = req.params.filename;
  if (!PROJECT_NAME_RE.test(name) || !READABLE_FILES.has(filename)) {
    return res.status(400).json({ error: 'Bad request' });
  }
  const fp = join(projectPath(name), filename);
  try {
    if (!existsSync(fp)) return res.json({ content: '' });
    res.json({ content: readFileSync(fp, 'utf-8') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:name/file/:filename', (req, res) => {
  const name = req.params.name;
  const filename = req.params.filename;
  if (!PROJECT_NAME_RE.test(name) || !EDITABLE_FILES.has(filename)) {
    return res.status(400).json({ error: 'Bad request' });
  }
  const content = req.body?.content ?? '';
  const base = projectPath(name);
  mkdirSync(base, { recursive: true });
  try {
    writeFileSync(join(base, filename), String(content), 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/runs/:runId/stream', (req, res) => {
  const { runId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  if (!streamClients.has(runId)) streamClients.set(runId, new Set());
  streamClients.get(runId).add(res);

  const hello = JSON.stringify({ text: '' });
  res.write(`data: ${hello}\n\n`);

  req.on('close', () => {
    streamClients.get(runId)?.delete(res);
  });
});

app.post('/api/projects/:name/recon', (req, res) => {
  const name = req.params.name;
  if (!PROJECT_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Bad project name' });
  }
  const {
    runId,
    steps = [],
    keywords = '',
    blacklist = '',
    runConfig = {},
  } = req.body || {};

  if (!runId || typeof runId !== 'string') {
    return res.status(400).json({ error: 'runId required (open SSE stream first)' });
  }
  const allowed = new Set(STEP_ORDER);
  const stepList = Array.isArray(steps) ? steps.filter((s) => allowed.has(s)) : [];
  if (stepList.length === 0) {
    return res.status(400).json({ error: 'Select at least one step' });
  }

  const needsKw = stepList.some((s) =>
    s === 'bing' || s === 'duckduckgo' || s === 'google' || s === 'clean',
  );
  const kwTrim = String(keywords).trim();
  if (needsKw && !kwTrim) {
    return res.status(400).json({ error: 'Keywords required for scrape engines or Clean' });
  }

  res.json({ ok: true, started: true });

  const safeRunConfig = {};
  for (const key of ['bing', 'duckduckgo', 'google']) {
    const raw = runConfig?.[key];
    if (!raw || typeof raw !== 'object') continue;
    const obj = {};
    const mp = Number(raw.maxPages);
    if (Number.isFinite(mp) && mp >= 1) obj.maxPages = Math.floor(mp);
    const off = Number(raw.offset);
    if (Number.isFinite(off) && off >= 0) obj.offset = Math.floor(off);
    safeRunConfig[key] = obj;
  }

  void executeReconJob(runId, name, stepList, String(keywords), String(blacklist), safeRunConfig)
    .then(() => emitRunDone(runId, true, ''))
    .catch((e) => {
      if (e.message === 'STOPPED') {
        emitRunLog(runId, '\n[gui] Run stopped by user.\n');
        emitRunDone(runId, false, 'Stopped', { stopped: true });
      } else {
        emitRunLog(runId, `\n[gui] ERROR: ${e.message}\n`);
        emitRunDone(runId, false, e.message);
      }
    })
    .finally(() => {
      const entry = activeRuns.get(runId);
      if (entry) entry.updatedAt = Date.now();
    });
});

app.post('/api/runs/:runId/stop', (req, res) => {
  const { runId } = req.params;
  const entry = activeRuns.get(runId);
  if (!entry) {
    return res.status(404).json({ error: 'No active run for this id' });
  }
  entry.aborted = true;
  entry.status = 'stopping';
  entry.updatedAt = Date.now();
  for (const child of [...entry.children]) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* */
    }
  }
  res.json({ ok: true });
});

app.get('/api/projects/:name/browse', (req, res) => {
  const name = req.params.name;
  if (!PROJECT_NAME_RE.test(name)) return res.status(400).json({ error: 'Bad name' });
  const rel = req.query.path != null ? String(req.query.path) : '';
  try {
    const dirPath = safeProjectFile(name, rel);
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      return res.status(404).json({ error: 'Not a directory' });
    }
    const names = readdirSync(dirPath).filter((f) => !f.startsWith('.'));
    const entries = names
      .map((n) => {
        const fp = join(dirPath, n);
        try {
          const st = statSync(fp);
          return {
            name: n,
            type: st.isDirectory() ? 'dir' : 'file',
            size: st.isFile() ? st.size : undefined,
            mtime: st.mtimeMs,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: rel.replace(/\\/g, '/'), entries });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/projects/:name/view-text', (req, res) => {
  const name = req.params.name;
  if (!PROJECT_NAME_RE.test(name)) return res.status(400).json({ error: 'Bad name' });
  const rel = String(req.query.path || '');
  try {
    const fp = safeProjectFile(name, rel);
    if (!existsSync(fp) || !statSync(fp).isFile()) {
      return res.status(404).json({ error: 'Not a file' });
    }
    if (statSync(fp).size > TEXT_VIEW_MAX) {
      return res.status(413).json({ error: 'File too large to view in browser' });
    }
    const st = statSync(fp);
    const buf = readFileSync(fp);
    const nul = buf.indexOf(0);
    if (nul >= 0 && nul < 8192) {
      return res.status(415).json({ error: 'Binary file — use raw download or image viewer' });
    }
    res.json({
      path: rel.replace(/\\/g, '/'),
      content: buf.toString('utf-8'),
      sizeBytes: st.size,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/projects/:name/raw', (req, res) => {
  const name = req.params.name;
  if (!PROJECT_NAME_RE.test(name)) return res.status(400).send('Bad name');
  const rel = String(req.query.path || '');
  try {
    const fp = safeProjectFile(name, rel);
    if (!existsSync(fp) || !statSync(fp).isFile()) {
      return res.status(404).send('Not found');
    }
    const ext = extOf(fp);
    res.setHeader('Content-Type', mimeForExt(ext));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(fp);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

app.get('/api/projects/:name/images-in-dir', (req, res) => {
  const name = req.params.name;
  if (!PROJECT_NAME_RE.test(name)) return res.status(400).json({ error: 'Bad name' });
  const rel = String(req.query.dir != null ? req.query.dir : '');
  try {
    const dirPath = safeProjectFile(name, rel);
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      return res.status(404).json({ error: 'Not a directory' });
    }
    const names = readdirSync(dirPath).filter((f) => !f.startsWith('.'));
    const images = names
      .filter((f) => IMAGE_EXT.has(extOf(f)))
      .sort((a, b) => a.localeCompare(b));
    const prefix = rel.replace(/\\/g, '/').replace(/\/+$/, '');
    const paths = images.map((f) => (prefix ? `${prefix}/${f}` : f));
    res.json({ dir: rel.replace(/\\/g, '/'), images, paths });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = Number(process.env.GHOST_GUI_PORT) || 3847;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`DRISHTI GUI http://127.0.0.1:${PORT}`);
});
