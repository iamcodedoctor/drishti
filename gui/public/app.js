const $ = (sel, root = document) => root.querySelector(sel);

const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
]);

/** Dashboard project row — inline SVGs (stroke follows currentColor). */
const ICON_DASH_OPEN = `<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.8V17a2 2 0 002 2h12a2 2 0 002-2V9.9a2 2 0 00-1.9-2h-5.4l-1.6-1.7H6a2 2 0 00-2 2v.6z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>`;

const ICON_DASH_RUN = `<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.75"/><path d="M10.2 8.8L16 12l-5.8 3.2V8.8z" fill="currentColor" stroke="none"/></svg>`;

const ICON_DASH_DELETE = `<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 7h12M9 7V5.5h6V7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M8 7l.8 12.2c.1 1 .9 1.8 1.9 1.8h3.6c1 0 1.8-.8 1.9-1.8L16 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 10.5v6M13.5 10.5v6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;

function showError(msg) {
  const el = $('#error-banner');
  if (!msg) {
    el.classList.remove('visible');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.add('visible');
}

/** @returns {{ route: 'dashboard'|'project'|'projectInputs'|'browse'|'text'|'config'|'stats'|'running'|'runningList', name?: string, browsePath?: string, filePath?: string, project?: string, runId?: string }} */
function parseHash() {
  let h = location.hash.slice(1) || '/';
  if (!h.startsWith('/')) h = `/${h}`;
  const qIdx = h.indexOf('?');
  const pathPart = qIdx >= 0 ? h.slice(0, qIdx) : h;
  const queryPart = qIdx >= 0 ? h.slice(qIdx + 1) : '';
  const params = new URLSearchParams(queryPart);
  const segments = pathPart.split('/').filter(Boolean);

  if (segments[0] === 'config') {
    return { route: 'config' };
  }
  if (segments[0] === 'stats') {
    return { route: 'stats' };
  }
  if (segments[0] === 'running') {
    return {
      route: 'running',
      project: params.get('project') || '',
      runId: params.get('runId') || '',
    };
  }
  if (segments[0] === 'running-list') {
    return { route: 'runningList' };
  }
  if (segments[0] === 'project' && segments[1]) {
    const name = decodeURIComponent(segments[1]);
    if (segments[2] === 'inputs') {
      return { route: 'projectInputs', name };
    }
    if (segments[2] === 'browse') {
      return { route: 'browse', name, browsePath: params.get('path') || '' };
    }
    if (segments[2] === 'text') {
      return { route: 'text', name, filePath: params.get('path') || '' };
    }
    return { route: 'project', name };
  }
  return { route: 'dashboard' };
}

function hashProjectBrowse(name, path = '') {
  const q = path ? `?path=${encodeURIComponent(path)}` : '';
  location.hash = `#/project/${encodeURIComponent(name)}/browse${q}`;
}

function hashProjectText(name, filePath) {
  location.hash = `#/project/${encodeURIComponent(name)}/text?path=${encodeURIComponent(filePath)}`;
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || r.statusText };
  }
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

/**
 * Download recon contacts aggregate (CSV or XLSX). Uses raw fetch — not `api()` — for binary bodies.
 * @param {string} projectName
 * @param {'csv'|'xlsx'} format
 */
async function downloadReconContactsExport(projectName, format) {
  const url = `/api/projects/${encodeURIComponent(projectName)}/export-recon-contacts?format=${encodeURIComponent(format)}`;
  const r = await fetch(url);
  const ct = r.headers.get('content-type') || '';
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    if (ct.includes('application/json')) {
      try {
        const j = await r.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* */
      }
    } else {
      try {
        const t = await r.text();
        if (t) msg = t.length > 240 ? `${t.slice(0, 240)}…` : t;
      } catch {
        /* */
      }
    }
    throw new Error(msg);
  }
  const blob = await r.blob();
  const ext = format === 'csv' ? 'csv' : 'xlsx';
  const safeBase = projectName.replace(/[^\w.-]+/g, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeBase}-recon-contacts.${ext}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function getScrapeSettings() {
  const { settings } = await api('/api/settings/scrape');
  return settings || { maxPages: 2, perEngine: {} };
}

async function setScrapeSettings(payload) {
  const { settings } = await api('/api/settings/scrape', {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
  return settings || { maxPages: 2, perEngine: {} };
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function countLines(text) {
  if (text === '') return 0;
  return text.split('\n').length;
}

function approxViewportLines(el) {
  const cs = getComputedStyle(el);
  let lh = parseFloat(cs.lineHeight);
  if (!Number.isFinite(lh) || lh <= 0) {
    lh = parseFloat(cs.fontSize) * 1.45;
  }
  const h = el.clientHeight;
  if (h <= 0) return 1;
  return Math.max(1, Math.floor(h / lh));
}

function isSafeHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Strip trailing punctuation often glued from SERP / markdown. */
function trimUrlMatch(raw) {
  let u = raw;
  while (u.length > 12 && /[)\].,;:!?'"]$/.test(u)) {
    u = u.slice(0, -1);
  }
  return u;
}

/**
 * Escape plain text and wrap http(s) URLs in anchors (for click-to-copy / ctrl-open).
 */
function linkifyPlainTextToHtml(raw) {
  if (!raw) return '';
  const re = /\bhttps?:\/\/[^\s<>'"]+/gi;
  let out = '';
  let i = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    out += escapeHtml(raw.slice(i, m.index));
    const trimmed = trimUrlMatch(m[0]);
    if (isSafeHttpUrl(trimmed)) {
      const esc = escapeHtml(trimmed);
      out += `<a href="${esc}" class="text-url" title="Click to copy · Ctrl+click (or ⌘+click) to open · middle-click opens new tab" rel="noopener noreferrer">${esc}</a>`;
    } else {
      out += escapeHtml(m[0]);
    }
    i = m.index + m[0].length;
  }
  out += escapeHtml(raw.slice(i));
  return out;
}

/**
 * @param {HTMLElement} el container with .text-url links
 * @param {(url: string) => void} [onCopied] optional feedback
 */
function wireTextUrlInteractions(el, onCopied) {
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a.text-url');
    if (!a) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener,noreferrer');
      return;
    }
    e.preventDefault();
    const url = a.href;
    void navigator.clipboard.writeText(url).then(
      () => onCopied?.(url),
      () => onCopied?.(null),
    );
  });
  el.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const a = e.target.closest('a.text-url');
    if (!a) return;
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener,noreferrer');
  });
}

function renderNav(parsed) {
  const nav = $('#nav-global');
  const p = parsed || parseHash();
  nav.innerHTML = `
    <a href="#/config"${p.route === 'config' ? ' class="badge"' : ''}>Config</a>
    <a href="#/stats"${p.route === 'stats' ? ' class="badge"' : ''}>Statistics</a>
    <a href="#/running-list"${p.route === 'runningList' ? ' class="badge"' : ''}>Running instances</a>
  `;
}

/** --- Image modal --- */
let imageModalState = {
  project: '',
  paths: [],
  index: 0,
};

function rawImageUrl(project, relPath) {
  return `/api/projects/${encodeURIComponent(project)}/raw?path=${encodeURIComponent(relPath)}`;
}

function syncImageModal() {
  const { project, paths, index } = imageModalState;
  const modal = $('#image-modal');
  const img = $('#image-modal-img');
  const cap = $('#image-modal-caption');
  if (!paths.length) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    return;
  }
  const p = paths[index];
  img.src = rawImageUrl(project, p);
  img.alt = p;
  cap.textContent = `${index + 1} / ${paths.length} — ${p}`;
  $('#image-modal-prev').disabled = index <= 0;
  $('#image-modal-next').disabled = index >= paths.length - 1;
}

function openImageModal(project, dirRel, startPath) {
  void (async () => {
    try {
      const { paths } = await api(
        `/api/projects/${encodeURIComponent(project)}/images-in-dir?dir=${encodeURIComponent(dirRel)}`,
      );
      if (!paths.length) {
        showError('No images in this folder');
        return;
      }
      const idx = Math.max(0, paths.indexOf(startPath));
      imageModalState = { project, paths, index: idx >= 0 ? idx : 0 };
      const modal = $('#image-modal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      syncImageModal();
    } catch (e) {
      showError(e.message);
    }
  })();
}

function closeImageModal() {
  $('#image-modal').classList.remove('open');
  $('#image-modal').setAttribute('aria-hidden', 'true');
  $('#image-modal-img').removeAttribute('src');
  imageModalState = { project: '', paths: [], index: 0 };
}

function wireImageModalOnce() {
  if (window.__imageModalWired) return;
  window.__imageModalWired = true;
  $('#image-modal-close').onclick = () => closeImageModal();
  $('#image-modal-backdrop').addEventListener('click', () => closeImageModal());
  $('#image-modal-prev').onclick = () => {
    if (imageModalState.index > 0) {
      imageModalState.index--;
      syncImageModal();
    }
  };
  $('#image-modal-next').onclick = () => {
    if (imageModalState.index < imageModalState.paths.length - 1) {
      imageModalState.index++;
      syncImageModal();
    }
  };
  document.addEventListener('keydown', (ev) => {
    if (!$('#image-modal').classList.contains('open')) return;
    if (ev.key === 'Escape') closeImageModal();
    if (ev.key === 'ArrowLeft') $('#image-modal-prev').click();
    if (ev.key === 'ArrowRight') $('#image-modal-next').click();
  });
}

/** --- Dashboard --- */
function isRunTerminatedStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

async function loadDashboard() {
  showError('');
  const { projects } = await api('/api/projects');

  $('#view-dashboard').innerHTML = `
    <div class="panel dashboard-new">
      <h2>New project</h2>
      <div class="row">
        <input type="text" id="new-project-name" placeholder="e.g. acme-campaign" style="max-width: 320px" />
        <button type="button" id="btn-create-project">Create</button>
      </div>
      <p class="hint">Letters, digits, <code>.</code> <code>_</code> <code>-</code> only. Each project lives under <code>data/</code>.</p>
    </div>
    <div class="panel dashboard-list">
      <h2>Your projects</h2>
      <input type="search" id="project-search" class="project-search" placeholder="Search projects…" autocomplete="off" />
      <div class="project-list-scroll">
        <ul class="project-list" id="project-list-ul"></ul>
      </div>
    </div>`;

  function projectRowHtml(p) {
    return `
      <li>
        <div class="project-list-info">
          <a class="project-link" href="#/project/${encodeURIComponent(p.name)}/browse">${escapeHtml(p.name)}</a>
          <div class="badge">kw ${p.hasKeywords ? '✓' : '—'} · bl ${p.hasBlacklist ? '✓' : '—'} · raw ${p.hasRaw ? '✓' : '—'} · clean ${p.hasCleaned ? '✓' : '—'}</div>
        </div>
        <div class="row project-list-actions">
          <a class="btn secondary btn-icon-only" href="#/project/${encodeURIComponent(p.name)}/browse" title="Open project" aria-label="Open project">${ICON_DASH_OPEN}</a>
          <a class="btn btn-icon-only" href="#/project/${encodeURIComponent(p.name)}/inputs" title="Start recon" aria-label="Start recon run">${ICON_DASH_RUN}</a>
          <button type="button" class="danger btn-icon-only" data-delete-project="${encodeURIComponent(p.name)}" title="Delete project" aria-label="Delete project">${ICON_DASH_DELETE}</button>
        </div>
      </li>`;
  }

  function wireDeleteButtons() {
    $('#project-list-ul').querySelectorAll('[data-delete-project]').forEach((btn) => {
      btn.onclick = async () => {
        const name = decodeURIComponent(btn.getAttribute('data-delete-project') || '');
        if (!name) return;
        if (!confirm(`Delete project "${name}" and all files under data/${name}?`)) return;
        try {
          await api(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
          showError('');
          await loadDashboard();
        } catch (e) {
          showError(e.message);
        }
      };
    });
  }

  function applyProjectFilter() {
    const q = ($('#project-search').value || '').trim().toLowerCase();
    const filtered = !q ? projects : projects.filter((p) => p.name.toLowerCase().includes(q));
    const ul = $('#project-list-ul');
    if (!projects.length) {
      ul.innerHTML =
        '<li class="project-list-empty"><h3 class="project-list-empty-title">No projects yet. Create one above.</h3></li>';
      return;
    }
    if (!filtered.length) {
      ul.innerHTML =
        '<li class="project-list-empty project-list-empty--compact"><h3 class="project-list-empty-title">No projects match your search.</h3></li>';
      return;
    }
    ul.innerHTML = filtered.map(projectRowHtml).join('');
    wireDeleteButtons();
  }

  $('#project-search').addEventListener('input', () => applyProjectFilter());
  applyProjectFilter();

  $('#btn-create-project').onclick = async () => {
    const name = $('#new-project-name').value.trim();
    if (!name) return showError('Enter a project name');
    try {
      await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
      $('#new-project-name').value = '';
      await loadDashboard();
    } catch (e) {
      showError(e.message);
    }
  };

  $('#view-project').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-dashboard').style.display = 'block';
}

async function loadConfig() {
  showError('');
  let scrapeSettings = {
    maxPages: 2,
    perEngine: { bing: { offset: 0 }, duckduckgo: { offset: 0 }, google: { offset: 0 } },
  };
  let settingsLoadError = '';
  try {
    const loaded = await getScrapeSettings();
    if (loaded && typeof loaded === 'object') {
      scrapeSettings = loaded;
    }
  } catch (e) {
    settingsLoadError = e.message || 'Could not load settings from server';
  }
  const bing = scrapeSettings.perEngine?.bing || {};
  const ddg = scrapeSettings.perEngine?.duckduckgo || {};
  const google = scrapeSettings.perEngine?.google || {};

  $('#view-config').innerHTML = `
    <div class="panel">
      <h2>Config</h2>
      ${settingsLoadError ? `<div class="error-banner visible">Settings API unavailable: ${escapeHtml(settingsLoadError)}. Showing local defaults.</div>` : ''}
      <p class="hint">Global defaults. If values are not defined later, these defaults are used.</p>
      <div class="row" style="gap:0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem">
        <label class="hint" for="cfg-global-max">Global max pages</label>
        <input id="cfg-global-max" type="number" min="1" max="50" value="${escapeHtml(String(scrapeSettings.maxPages || 2))}" style="max-width: 140px" />
      </div>
      <div class="panel" style="margin-bottom: 0.75rem">
        <h2>Bing</h2>
        <div class="row" style="gap:0.75rem; flex-wrap: wrap">
          <label class="hint" for="cfg-bing-pages">Pages</label>
          <input id="cfg-bing-pages" type="number" min="1" max="50" value="${escapeHtml(String(bing.maxPages || ''))}" placeholder="inherit global" style="max-width: 140px" />
          <label class="hint" for="cfg-bing-offset">Offset</label>
          <input id="cfg-bing-offset" type="number" min="0" max="5000" value="${escapeHtml(String(bing.offset ?? 0))}" style="max-width: 140px" />
        </div>
      </div>
      <div class="panel" style="margin-bottom: 0.75rem">
        <h2>DuckDuckGo</h2>
        <div class="row" style="gap:0.75rem; flex-wrap: wrap">
          <label class="hint" for="cfg-ddg-pages">Pages</label>
          <input id="cfg-ddg-pages" type="number" min="1" max="50" value="${escapeHtml(String(ddg.maxPages || ''))}" placeholder="inherit global" style="max-width: 140px" />
          <label class="hint" for="cfg-ddg-offset">Offset</label>
          <input id="cfg-ddg-offset" type="number" min="0" max="5000" value="${escapeHtml(String(ddg.offset ?? 0))}" style="max-width: 140px" />
        </div>
      </div>
      <div class="panel">
        <h2>Google</h2>
        <p class="hint">Slower, pointer-driven session — solve CAPTCHAs manually if shown.</p>
        <div class="row" style="gap:0.75rem; flex-wrap: wrap">
          <label class="hint" for="cfg-google-pages">Pages</label>
          <input id="cfg-google-pages" type="number" min="1" max="50" value="${escapeHtml(String(google.maxPages || ''))}" placeholder="inherit global" style="max-width: 140px" />
          <label class="hint" for="cfg-google-offset">Offset</label>
          <input id="cfg-google-offset" type="number" min="0" max="5000" value="${escapeHtml(String(google.offset ?? 0))}" style="max-width: 140px" />
        </div>
      </div>
      <div class="row" style="margin-top: 0.9rem">
        <button type="button" id="btn-save-config">Save config</button>
      </div>
    </div>`;

  $('#btn-save-config').onclick = async () => {
    try {
      const payload = {
        maxPages: Number($('#cfg-global-max').value),
        perEngine: {
          bing: {
            maxPages: $('#cfg-bing-pages').value.trim() ? Number($('#cfg-bing-pages').value) : null,
            offset: Number($('#cfg-bing-offset').value || 0),
          },
          duckduckgo: {
            maxPages: $('#cfg-ddg-pages').value.trim() ? Number($('#cfg-ddg-pages').value) : null,
            offset: Number($('#cfg-ddg-offset').value || 0),
          },
          google: {
            maxPages: $('#cfg-google-pages').value.trim() ? Number($('#cfg-google-pages').value) : null,
            offset: Number($('#cfg-google-offset').value || 0),
          },
        },
      };
      await setScrapeSettings(payload);
      showError('');
      settingsLoadError = '';
      await loadConfig();
    } catch (e) {
      showError(e.message);
    }
  };

  $('#view-dashboard').style.display = 'none';
  $('#view-project').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-config').style.display = 'block';
}

function loadStats() {
  showError('');
  $('#view-stats').innerHTML = `
    <div class="panel">
      <h2>Statistics</h2>
      <h1>Work in progress</h1>
    </div>`;

  $('#view-dashboard').style.display = 'none';
  $('#view-project').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-stats').style.display = 'block';
}

/** --- Full-screen file browser --- */
async function loadBrowse(name, browsePath) {
  return loadOutputViewer(name, browsePath || '', '');
}

/** --- Full-screen text viewer --- */
async function loadTextViewer(name, filePath) {
  const parentDir = filePath && filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  return loadOutputViewer(name, parentDir, filePath || '');
}

function parentPath(rel) {
  if (!rel) return '';
  const parts = String(rel).split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

async function loadOutputViewer(name, browsePath = '', selectedFilePath = '') {
  showError('');

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    showError('Invalid project name');
    return loadDashboard();
  }

  const currentDir = String(browsePath || '');
  const selectedFile = String(selectedFilePath || '');
  const currentLabel = selectedFile || (currentDir ? `${currentDir}/` : `${name}/`);
  const canGoUp = !!(selectedFile || currentDir);
  const upTarget = selectedFile ? parentPath(selectedFile) : parentPath(currentDir);
  const atProjectRoot = !currentDir;

  const exportButtons = atProjectRoot
    ? `
          <button type="button" class="btn secondary" id="ov-export-csv" title="All domains under recon with contacts.json">Export CSV</button>
          <button type="button" class="btn" id="ov-export-xlsx" title="Styled workbook: navy header, row tint by data completeness">Export Excel</button>`
    : '';

  $('#view-browse').innerHTML = `
    <div class="output-viewer">
      <div class="output-viewer-header">
        <div class="output-viewer-heading">
          <h2>${escapeHtml(name)}</h2>
          <div class="output-viewer-subline">
            <button type="button" class="btn secondary output-up-btn" id="ov-up-btn"${canGoUp ? '' : ' disabled'} aria-label="Go one directory up">←</button>
            <span class="output-current">${escapeHtml(currentLabel)}</span>
          </div>
        </div>
        <div class="row output-viewer-actions">
          <a class="btn secondary" href="#/project/${encodeURIComponent(name)}/browse">Project root</a>
          <a class="btn secondary" href="#/project/${encodeURIComponent(name)}/inputs">Re-run</a>
          ${exportButtons}
        </div>
      </div>
      <div class="output-viewer-main">
        <div class="output-sidebar">
          <div class="output-list-search-wrap">
            <label class="visually-hidden" for="ov-list-search">Search files and folders in this folder</label>
            <input type="search" id="ov-list-search" class="output-list-search" placeholder="Search files & folders…" autocomplete="off" spellcheck="false" />
          </div>
          <ul id="ov-list" class="output-list"></ul>
        </div>
        <div class="output-preview">
          <div id="ov-preview-content" class="output-preview-content"></div>
          <div id="ov-preview-status" class="viewer-statusbar">—</div>
        </div>
      </div>
    </div>`;

  const listEl = $('#ov-list');
  const previewEl = $('#ov-preview-content');
  const statusEl = $('#ov-preview-status');
  $('#ov-up-btn').onclick = () => {
    if (!canGoUp) return;
    hashProjectBrowse(name, upTarget);
  };

  const q = currentDir ? `?path=${encodeURIComponent(currentDir)}` : '';
  const data = await api(`/api/projects/${encodeURIComponent(name)}/browse${q}`);
  const entries = data.entries || [];
  const dirPath = data.path || '';

  const rows = [];
  if (dirPath) {
    rows.push(`<li data-nav-up="1"><span>..</span><span class="meta">parent</span></li>`);
  }
  for (const ent of entries) {
    const rel = dirPath ? `${dirPath}/${ent.name}` : ent.name;
    const size = ent.type === 'file' && typeof ent.size === 'number' ? formatBytes(ent.size) : '';
    rows.push(`
      <li data-rel="${encodeURIComponent(rel)}" data-type="${ent.type}">
        <span>${ent.type === 'dir' ? '📁' : '📄'} ${escapeHtml(ent.name)}</span>
        <span class="meta">${escapeHtml(size || ent.type)}</span>
      </li>`);
  }
  listEl.innerHTML = rows.join('') || '<li><span class="hint">No files in this directory.</span></li>';

  listEl.querySelectorAll('li[data-nav-up]').forEach((li) => {
    li.onclick = () => hashProjectBrowse(name, parentPath(dirPath));
  });
  listEl.querySelectorAll('li[data-rel]').forEach((li) => {
    li.onclick = () => {
      const rel = decodeURIComponent(li.getAttribute('data-rel') || '');
      const type = li.getAttribute('data-type');
      if (type === 'dir') {
        hashProjectBrowse(name, rel);
        return;
      }
      hashProjectText(name, rel);
    };
  });

  const searchInput = /** @type {HTMLInputElement} */ ($('#ov-list-search'));
  function applyListFilter() {
    const q = (searchInput.value || '').trim().toLowerCase();
    listEl.querySelectorAll('li').forEach((li) => {
      if (li.hasAttribute('data-nav-up')) {
        li.style.display = q ? 'none' : '';
        return;
      }
      const enc = li.getAttribute('data-rel');
      if (!enc) {
        li.style.display = '';
        return;
      }
      const rel = decodeURIComponent(enc);
      const base = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
      li.style.display = !q || base.toLowerCase().includes(q) ? '' : 'none';
    });
  }
  searchInput.addEventListener('input', applyListFilter);

  if (atProjectRoot) {
    $('#ov-export-csv').onclick = () => {
      downloadReconContactsExport(name, 'csv').catch((e) => showError(e.message));
    };
    $('#ov-export-xlsx').onclick = () => {
      downloadReconContactsExport(name, 'xlsx').catch((e) => showError(e.message));
    };
  }

  async function renderSelectedFile() {
    if (!selectedFile) {
      previewEl.innerHTML = '<div class="output-preview-empty">Select a file to view output.</div>';
      statusEl.textContent = `${entries.length} items in ${dirPath || `${name}/`}`;
      return;
    }

    const ext = extOf(selectedFile);
    if (IMAGE_EXT.has(ext)) {
      const dirRel = selectedFile.includes('/') ? selectedFile.slice(0, selectedFile.lastIndexOf('/')) : '';
      const imgList = await api(
        `/api/projects/${encodeURIComponent(name)}/images-in-dir?dir=${encodeURIComponent(dirRel)}`,
      ).catch(() => ({ paths: [selectedFile] }));
      const paths = imgList.paths?.length ? imgList.paths : [selectedFile];
      let idx = Math.max(0, paths.indexOf(selectedFile));
      let zoom = 1;
      const MIN_ZOOM = 0.25;
      const MAX_ZOOM = 4;
      const ZOOM_STEP = 0.25;

      function clampZoom(v) {
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
      }

      function formatZoom(v) {
        return `${Math.round(v * 100)}%`;
      }

      const renderImage = () => {
        const rel = paths[idx];
        const src = rawImageUrl(name, rel);
        previewEl.innerHTML = `
          <div class="output-image-wrap">
            <div class="output-image-toolbar">
              <button type="button" class="secondary" id="ov-img-prev"${idx <= 0 ? ' disabled' : ''}>← Prev</button>
              <span class="badge">${idx + 1}/${paths.length} · ${escapeHtml(rel)}</span>
              <div class="row" style="gap:0.35rem;">
                <button type="button" class="secondary" id="ov-img-zoom-out" aria-label="Zoom out">−</button>
                <button type="button" class="secondary" id="ov-img-zoom-fit" aria-label="Fit to container">Fit</button>
                <button type="button" class="secondary" id="ov-img-zoom-in" aria-label="Zoom in">+</button>
                <span class="badge" id="ov-img-zoom-label">${formatZoom(zoom)}</span>
              </div>
              <button type="button" class="secondary" id="ov-img-next"${idx >= paths.length - 1 ? ' disabled' : ''}>Next →</button>
            </div>
            <div class="output-image-stage"><img id="ov-image" src="${src}" alt="${escapeHtml(rel)}" /></div>
          </div>`;
        statusEl.textContent = `image · ${ext.slice(1) || 'unknown'} · ${formatZoom(zoom)} · Use + / − / Fit`;
        const imgEl = $('#ov-image');
        const zoomLabel = $('#ov-img-zoom-label');
        const applyZoom = () => {
          imgEl.style.transform = `scale(${zoom})`;
          zoomLabel.textContent = formatZoom(zoom);
          statusEl.textContent = `image · ${ext.slice(1) || 'unknown'} · ${formatZoom(zoom)} · Use + / − / Fit`;
        };
        $('#ov-img-prev').onclick = () => { if (idx > 0) { idx -= 1; renderImage(); } };
        $('#ov-img-next').onclick = () => { if (idx < paths.length - 1) { idx += 1; renderImage(); } };
        $('#ov-img-zoom-out').onclick = () => {
          zoom = clampZoom(zoom - ZOOM_STEP);
          applyZoom();
        };
        $('#ov-img-zoom-in').onclick = () => {
          zoom = clampZoom(zoom + ZOOM_STEP);
          applyZoom();
        };
        $('#ov-img-zoom-fit').onclick = () => {
          zoom = 1;
          applyZoom();
        };
        applyZoom();
      };
      renderImage();
      return;
    }

    const textData = await api(
      `/api/projects/${encodeURIComponent(name)}/view-text?path=${encodeURIComponent(selectedFile)}`,
    );
    const raw = textData.content ?? '';
    previewEl.innerHTML = `<pre id="ov-text-area" class="fs-text-area" tabindex="0" spellcheck="false">${linkifyPlainTextToHtml(raw)}</pre>`;
    const ta = $('#ov-text-area');
    const totalLines = countLines(raw);
    const sizeBytes = typeof textData.sizeBytes === 'number'
      ? textData.sizeBytes
      : new TextEncoder().encode(raw).length;
    const fileExt = ext ? ext.slice(1) : 'txt';

    function baseStatus() {
      const approx = approxViewportLines(ta);
      return `${formatBytes(sizeBytes)} · ${approx} visible lines · ${totalLines.toLocaleString()} total lines · ${fileExt} · Click URL to copy · Ctrl/⌘+click opens`;
    }
    function refreshStatusBar(extra) {
      statusEl.textContent = extra ? `${baseStatus()} — ${extra}` : baseStatus();
    }

    const ro = new ResizeObserver(() => refreshStatusBar());
    ro.observe(ta);
    ta.addEventListener('scroll', () => refreshStatusBar());
    window.addEventListener('resize', () => refreshStatusBar());
    wireTextUrlInteractions(ta, (url) => {
      if (url) refreshStatusBar(`Copied: ${url}`);
      else refreshStatusBar('Copy failed');
      window.setTimeout(() => refreshStatusBar(), 1400);
    });
    refreshStatusBar();
  }
  await renderSelectedFile();

  $('#view-dashboard').style.display = 'none';
  $('#view-project').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-browse').style.display = 'flex';
}

/** --- Project home (centered file browser) --- */
async function loadProject(name) {
  showError('');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    showError('Invalid project name');
    return loadDashboard();
  }
  let entries = [];
  try {
    const data = await api(`/api/projects/${encodeURIComponent(name)}/browse`);
    entries = data.entries || [];
  } catch (e) {
    showError(e.message);
  }

  $('#view-project').innerHTML = `
    <div class="panel" style="max-width:860px;margin:0 auto;">
      <h2>${escapeHtml(name)} — File browser</h2>
      <p class="hint">Project root files and folders.</p>
      <ul class="explorer-list" style="max-height:420px;margin-bottom:1rem;">
        ${entries.map((ent) => {
          const rel = ent.name;
          const q = ent.type === 'dir'
            ? `#/project/${encodeURIComponent(name)}/browse?path=${encodeURIComponent(rel)}`
            : `#/project/${encodeURIComponent(name)}/text?path=${encodeURIComponent(rel)}`;
          return `<li><span>${ent.type === 'dir' ? '📁' : '📄'} <a href="${q}">${escapeHtml(ent.name)}</a></span><span class="meta">${ent.type}</span></li>`;
        }).join('') || '<li><span class="hint">No files yet.</span></li>'}
      </ul>
      <div class="row" style="justify-content:center;">
        <a class="btn secondary" href="#/project/${encodeURIComponent(name)}/browse">Open full browser</a>
        <a class="btn" href="#/project/${encodeURIComponent(name)}/inputs">Re-run</a>
      </div>
    </div>`;

  $('#view-dashboard').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-project').style.display = 'block';
}

async function loadProjectInputs(name) {
  showError('');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    showError('Invalid project name');
    return loadDashboard();
  }
  const [k, b, scrapeSettings] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(name)}/file/keywords.txt`).catch(() => ({ content: '' })),
    api(`/api/projects/${encodeURIComponent(name)}/file/blacklist.txt`).catch(() => ({ content: '' })),
    getScrapeSettings().catch(() => ({ maxPages: 2, perEngine: {} })),
  ]);
  const keywords = k.content || '';
  const blacklist = b.content || '';
  const defaults = scrapeSettings.perEngine || {};

  $('#view-project').innerHTML = `
    <div class="panel" style="max-width:920px;margin:0 auto;">
      <h2>${escapeHtml(name)} — Inputs</h2>
      <p class="hint">Prefilled when files exist. On <strong>Start recon</strong>, these are written to the project folder before the run (when scrape/clean steps run).</p>
      <label class="hint" for="fld-keywords">keywords</label>
      <textarea id="fld-keywords" placeholder="# one keyword per line"></textarea>
      <label class="hint" for="fld-blacklist" style="display:block;margin-top:1rem">blacklist</label>
      <textarea id="fld-blacklist" placeholder="# one domain per line"></textarea>
      <div class="chk-wrap" style="margin-top:1rem">
        <label class="chk"><input type="checkbox" name="step" value="bing" /> Bing</label>
        <label class="chk"><input type="checkbox" name="step" value="duckduckgo" /> DuckDuckGo</label>
        <label class="chk"><input type="checkbox" name="step" value="google" /> Google</label>
        <label class="chk"><input type="checkbox" name="step" value="clean" /> Clean</label>
        <label class="chk"><input type="checkbox" name="step" value="inspector" /> Inspector</label>
        <label class="chk" style="margin-top: 6px; display: block;"><input type="checkbox" name="step" value="enum" /> Enum (LLM Contact Extractor)</label>
      </div>
      <div id="run-config-preview"></div>
      <div class="row" style="margin-top:1rem">
        <button type="button" id="btn-save-inputs" class="secondary">Save inputs</button>
        <button type="button" id="btn-recon">Start recon</button>
      </div>
    </div>`;

  $('#fld-keywords').value = keywords;
  $('#fld-blacklist').value = blacklist;

  function renderRunConfigPreview() {
    const steps = [...document.querySelectorAll('input[name="step"]:checked')].map((x) => x.value);
    const blocks = [];
    if (steps.includes('bing')) {
      const cfg = defaults.bing || {};
      blocks.push(`
        <div class="row" style="margin-bottom:0.5rem">
          <strong>Bing</strong>
          <label class="hint" for="run-bing-pages">Pages</label>
          <input id="run-bing-pages" type="number" min="1" max="50" value="${escapeHtml(String(cfg.maxPages || scrapeSettings.maxPages || 2))}" style="max-width:120px" />
          <label class="hint" for="run-bing-offset">Offset</label>
          <input id="run-bing-offset" type="number" min="0" max="5000" value="${escapeHtml(String(cfg.offset || 0))}" style="max-width:120px" />
        </div>
        <p class="hint" style="margin:0 0 0.5rem">Offset = SERP pages to open <em>without</em> saving URLs; Pages = how many SERP pages to extract after that (e.g. offset 2 + pages 3 → use results from SERP pages 3–5).</p>`);
    }
    if (steps.includes('duckduckgo')) {
      const cfg = defaults.duckduckgo || {};
      blocks.push(`
        <div class="row" style="margin-bottom:0.5rem">
          <strong>DuckDuckGo</strong>
          <label class="hint" for="run-ddg-pages">Pages</label>
          <input id="run-ddg-pages" type="number" min="1" max="50" value="${escapeHtml(String(cfg.maxPages || scrapeSettings.maxPages || 2))}" style="max-width:120px" />
          <label class="hint" for="run-ddg-offset">Offset</label>
          <input id="run-ddg-offset" type="number" min="0" max="5000" value="${escapeHtml(String(cfg.offset || 0))}" style="max-width:120px" />
        </div>
        <p class="hint" style="margin:0 0 0.5rem">Offset = “More results” loads to view without saving; Pages = batches to extract after (same idea as Bing page windows).</p>`);
    }
    if (steps.includes('google')) {
      const cfg = defaults.google || {};
      blocks.push(`
        <div class="row" style="margin-bottom:0.5rem">
          <strong>Google</strong>
          <label class="hint" for="run-google-pages">Pages</label>
          <input id="run-google-pages" type="number" min="1" max="50" value="${escapeHtml(String(cfg.maxPages || scrapeSettings.maxPages || 2))}" style="max-width:120px" />
          <label class="hint" for="run-google-offset">Offset</label>
          <input id="run-google-offset" type="number" min="0" max="5000" value="${escapeHtml(String(cfg.offset || 0))}" style="max-width:120px" />
        </div>
        <p class="hint" style="margin:0 0 0.5rem">Google: always opens google.com and types the query. Offset = SERP pages to scroll through <em>without</em> saving URLs; Pages = SERP pages to extract after. Example: offset 2 + pages 3 → visit pages 1–2 with no extract, then save URLs from pages 3–5.</p>`);
    }
    if (steps.includes('clean')) {
      blocks.push(
        '<div class="hint">Clean: raw results + merged blacklist (repo default list and project <code>blacklist.txt</code>, both apply). A listed host also blocks its subdomains (e.g. <code>acme.com</code> blocks <code>test.acme.com</code>), not other suffixes like <code>acme.in</code>.</div>',
      );
    }
    if (steps.includes('inspector')) blocks.push('<div class="hint">Inspector selected: uses cleaned results for deep analysis.</div>');
    if (steps.includes('enum')) blocks.push('<div class="hint">Enum selected: brute-forces contacts and extracts via LLM.</div>');
    $('#run-config-preview').innerHTML = blocks.length
      ? `<div class="panel" style="margin:0.75rem 0 0;"><h2>Run config</h2>${blocks.join('')}</div>`
      : '';
  }
  document.querySelectorAll('input[name="step"]').forEach((el) => {
    el.addEventListener('change', renderRunConfigPreview);
  });
  renderRunConfigPreview();

  $('#btn-save-inputs').onclick = async () => {
    try {
      await api(`/api/projects/${encodeURIComponent(name)}/file/keywords.txt`, {
        method: 'PUT',
        body: JSON.stringify({ content: $('#fld-keywords').value }),
      });
      await api(`/api/projects/${encodeURIComponent(name)}/file/blacklist.txt`, {
        method: 'PUT',
        body: JSON.stringify({ content: $('#fld-blacklist').value }),
      });
      showError('');
    } catch (e) {
      showError(e.message);
    }
  };

  $('#btn-recon').onclick = async () => {
    const steps = [...document.querySelectorAll('input[name="step"]:checked')].map((x) => x.value);
    if (!steps.length) return showError('Select at least one step');
    const needsKw = steps.some((s) => ['bing', 'duckduckgo', 'google', 'clean'].includes(s));
    const kw = $('#fld-keywords').value.trim();
    if (needsKw && !kw) return showError('Keywords required for scrape engines or Clean');
    const runId = crypto.randomUUID();
    try {
      const runConfig = {};
      if (steps.includes('bing')) {
        runConfig.bing = {
          maxPages: Number($('#run-bing-pages')?.value || scrapeSettings.maxPages || 2),
          offset: Number($('#run-bing-offset')?.value || 0),
        };
      }
      if (steps.includes('duckduckgo')) {
        runConfig.duckduckgo = {
          maxPages: Number($('#run-ddg-pages')?.value || scrapeSettings.maxPages || 2),
          offset: Number($('#run-ddg-offset')?.value || 0),
        };
      }
      if (steps.includes('google')) {
        runConfig.google = {
          maxPages: Number($('#run-google-pages')?.value || scrapeSettings.maxPages || 2),
          offset: Number($('#run-google-offset')?.value || 0),
        };
      }
      await api(`/api/projects/${encodeURIComponent(name)}/recon`, {
        method: 'POST',
        body: JSON.stringify({
          runId,
          steps,
          keywords: $('#fld-keywords').value,
          blacklist: $('#fld-blacklist').value,
          runConfig,
        }),
      });
      location.hash = `#/running?project=${encodeURIComponent(name)}&runId=${encodeURIComponent(runId)}`;
    } catch (e) {
      showError(e.message);
    }
  };

  $('#view-dashboard').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-project').style.display = 'block';
}

async function loadRunning(project = '', focusRunId = '') {
  showError('');
  const q = project ? `?project=${encodeURIComponent(project)}` : '';
  const data = await api(`/api/runs${q}`).catch(() => ({ runs: [] }));
  const runs = data.runs || [];
  const selected = focusRunId ? runs.find((r) => r.runId === focusRunId) : runs[0];
  let currentRunId = selected?.runId || '';
  const currentProject = selected?.projectName || project || '';
  let es = null;
  const terminateDisabledInitially =
    !currentRunId || isRunTerminatedStatus(selected?.status || '');

  const viewProjectHref = currentProject
    ? `#/project/${encodeURIComponent(currentProject)}/browse`
    : '#/';

  $('#view-project').innerHTML = `
    <div class="panel" style="max-width:1080px;margin:0 auto;">
      <div class="row" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:0.5rem;">
        <h2 style="margin:0;">${currentProject ? `Console — ${escapeHtml(currentProject)}` : 'Console'}</h2>
        <div class="row" style="gap:0.5rem">
          <a class="btn secondary" id="btn-view-project" href="${viewProjectHref}"${currentProject ? '' : ' aria-disabled="true" style="pointer-events:none;opacity:0.45"'}>View project</a>
          <button type="button" class="danger" id="btn-stop-run"${terminateDisabledInitially ? ' disabled' : ''}>Terminate</button>
        </div>
      </div>
      ${currentRunId ? '' : '<p class="hint">No run selected. Open Running instances page and choose one.</p>'}
      <pre class="console" id="run-console" style="min-height:420px;"></pre>
    </div>`;

  const consoleEl = $('#run-console');
  const stopBtn = $('#btn-stop-run');
  const append = (text) => {
    const line = document.createElement('div');
    line.className = 'line';
    line.textContent = text;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };

  function bindStream(runId, opts = {}) {
    if (es) es.close();
    consoleEl.innerHTML = '';
    if (!runId) return;
    currentRunId = runId;
    stopBtn.disabled = opts.alreadyTerminated === true;
    append(`[gui] Streaming run: ${runId}\n`);
    es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.text) append(payload.text);
        if (payload.done) {
          append(`\n[gui] ${payload.stopped ? 'Stopped' : payload.ok ? 'Completed' : `Error: ${payload.message || ''}`}\n`);
          stopBtn.disabled = true;
        }
      } catch {
        append(`${ev.data}\n`);
      }
    };
    es.onerror = () => {
      append('[gui] Log stream disconnected.\n');
    };
  }

  stopBtn.onclick = async () => {
    if (!currentRunId) return;
    try {
      await api(`/api/runs/${encodeURIComponent(currentRunId)}/stop`, { method: 'POST' });
      append('[gui] Stop signal sent.\n');
    } catch (e) {
      append(`[gui] Stop failed: ${e.message}\n`);
    }
  };

  if (currentRunId) bindStream(currentRunId, { alreadyTerminated: terminateDisabledInitially });

  $('#view-dashboard').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-project').style.display = 'block';
}

async function loadRunningList() {
  showError('');
  const data = await api('/api/runs').catch(() => ({ runs: [] }));
  const runs = data.runs || [];
  $('#view-project').innerHTML = `
    <div class="panel" style="max-width:980px;margin:0 auto;">
      <h2>Running instances</h2>
      <ul class="explorer-list" style="max-height:520px;">
        ${runs.map((r) => `
          <li>
            <span>
              <strong>${escapeHtml(r.projectName || 'project')}</strong><br>
              <span class="badge">${escapeHtml((r.steps || []).join(' -> ')) || 'steps'}</span>
            </span>
            <span class="row" style="gap:0.5rem">
              <span class="meta">${escapeHtml(r.status || 'running')}</span>
              <a class="btn secondary" href="#/running?project=${encodeURIComponent(r.projectName || '')}&runId=${encodeURIComponent(r.runId)}">Open console</a>
            </span>
          </li>`).join('') || '<li><span class="hint">No running instances right now.</span></li>'}
      </ul>
    </div>`;

  $('#view-dashboard').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-project').style.display = 'block';
}

function setShellMode(fs) {
  $('#main-shell').classList.toggle('main--fs', fs);
}

function route() {
  const parsed = parseHash();
  renderNav(parsed);
  setShellMode(parsed.route === 'browse' || parsed.route === 'text');

  $('#view-dashboard').style.display = 'none';
  $('#view-project').style.display = 'none';
  $('#view-config').style.display = 'none';
  $('#view-stats').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';

  if (parsed.route === 'dashboard') {
    void loadDashboard();
    return;
  }
  if (parsed.route === 'project') {
    hashProjectBrowse(parsed.name, '');
    return;
  }
  if (parsed.route === 'projectInputs') {
    void loadProjectInputs(parsed.name);
    return;
  }
  if (parsed.route === 'config') {
    void loadConfig();
    return;
  }
  if (parsed.route === 'stats') {
    loadStats();
    return;
  }
  if (parsed.route === 'running') {
    void loadRunning(parsed.project || '', parsed.runId || '');
    return;
  }
  if (parsed.route === 'runningList') {
    void loadRunningList();
    return;
  }
  if (parsed.route === 'browse') {
    void loadBrowse(parsed.name, parsed.browsePath || '');
    return;
  }
  if (parsed.route === 'text') {
    void loadTextViewer(parsed.name, parsed.filePath || '');
  }
}

window.addEventListener('hashchange', route);
route();
