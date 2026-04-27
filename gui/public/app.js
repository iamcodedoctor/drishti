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

/** @returns {{ route: 'dashboard'|'project'|'browse'|'text', name?: string, browsePath?: string, filePath?: string }} */
function parseHash() {
  let h = location.hash.slice(1) || '/';
  if (!h.startsWith('/')) h = `/${h}`;
  const qIdx = h.indexOf('?');
  const pathPart = qIdx >= 0 ? h.slice(0, qIdx) : h;
  const queryPart = qIdx >= 0 ? h.slice(qIdx + 1) : '';
  const params = new URLSearchParams(queryPart);
  const segments = pathPart.split('/').filter(Boolean);

  if (segments[0] === 'project' && segments[1]) {
    const name = decodeURIComponent(segments[1]);
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
  if (p.route === 'project') {
    nav.innerHTML = `<a href="#/">← Dashboard</a>
      <span class="badge"> / ${escapeHtml(p.name)}</span>
      · <a href="#/project/${encodeURIComponent(p.name)}/browse">Files</a>`;
  } else if (p.route === 'browse') {
    nav.innerHTML = `<a href="#/">← Dashboard</a>
      <a href="#/project/${encodeURIComponent(p.name)}">← ${escapeHtml(p.name)}</a>
      <span class="badge"> / files</span>`;
  } else if (p.route === 'text') {
    nav.innerHTML = `<a href="#/">← Dashboard</a>
      <a href="#/project/${encodeURIComponent(p.name)}">← ${escapeHtml(p.name)}</a>
      · <a href="#/project/${encodeURIComponent(p.name)}/browse${p.filePath && p.filePath.includes('/') ? `?path=${encodeURIComponent(p.filePath.slice(0, p.filePath.lastIndexOf('/')))}` : ''}">← Browser</a>
      <span class="badge"> / view</span>`;
  } else {
    nav.innerHTML = '';
  }
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
async function loadDashboard() {
  showError('');
  const { projects } = await api('/api/projects');
  const list = projects
    .map(
      (p) => `
      <li>
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <div class="badge">kw ${p.hasKeywords ? '✓' : '—'} · bl ${p.hasBlacklist ? '✓' : '—'} · raw ${p.hasRaw ? '✓' : '—'} · clean ${p.hasCleaned ? '✓' : '—'}</div>
        </div>
        <div class="row" style="gap:0.5rem">
          <a class="btn secondary" href="#/project/${encodeURIComponent(p.name)}">Open</a>
          <a class="btn secondary" href="#/project/${encodeURIComponent(p.name)}/browse">Files</a>
        </div>
      </li>`,
    )
    .join('');

  $('#view-dashboard').innerHTML = `
    <div class="panel">
      <h2>Projects</h2>
      <p class="hint">Each project is a folder under <code>data/</code>. Legacy <code>data/recon</code> is hidden from this list.</p>
      <ul class="project-list">${list || '<li class="hint">No projects yet — create one below.</li>'}</ul>
    </div>
    <div class="panel">
      <h2>Start new project</h2>
      <div class="row">
        <input type="text" id="new-project-name" placeholder="e.g. acme-campaign" style="max-width: 320px" />
        <button type="button" id="btn-create-project">Create folder</button>
      </div>
      <p class="hint">Letters, digits, <code>.</code> <code>_</code> <code>-</code> only.</p>
    </div>`;

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
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-dashboard').style.display = 'block';
}

/** --- Full-screen file browser --- */
async function loadBrowse(name, browsePath) {
  showError('');
  wireImageModalOnce();

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    showError('Invalid project name');
    return loadDashboard();
  }

  let explorerPath = browsePath || '';

  $('#view-browse').innerHTML = `
    <div class="fs-browse">
      <div class="fs-browse-top">
        <a class="btn secondary" href="#/project/${encodeURIComponent(name)}">← Project</a>
        <div id="fs-browse-breadcrumb" class="breadcrumb"></div>
      </div>
      <ul id="fs-browse-list" class="explorer-list fs-explorer-list"></ul>
    </div>`;

  const bc = $('#fs-browse-breadcrumb');
  const listEl = $('#fs-browse-list');

  async function refreshExplorer() {
    const q = explorerPath ? `?path=${encodeURIComponent(explorerPath)}` : '';
    const data = await api(`/api/projects/${encodeURIComponent(name)}/browse${q}`);
    explorerPath = data.path || '';

    const parts = explorerPath ? explorerPath.split('/') : [];
    let crumb = `<a href="#" data-crumb="${encodeURIComponent('')}">data/${escapeHtml(name)}</a>`;
    let acc = '';
    for (const seg of parts) {
      acc = acc ? `${acc}/${seg}` : seg;
      crumb += ` / <a href="#" data-crumb="${encodeURIComponent(acc)}">${escapeHtml(seg)}</a>`;
    }
    bc.innerHTML = crumb;
    bc.querySelectorAll('a[data-crumb]').forEach((a) => {
      a.onclick = (ev) => {
        ev.preventDefault();
        const next = decodeURIComponent(a.getAttribute('data-crumb') || '');
        hashProjectBrowse(name, next);
      };
    });

    listEl.innerHTML = (data.entries || [])
      .map((ent) => {
        const rel = explorerPath ? `${explorerPath}/${ent.name}` : ent.name;
        const size = ent.type === 'file' && typeof ent.size === 'number' ? `${ent.size} B` : '';
        return `<li data-rel="${encodeURIComponent(rel)}" data-type="${ent.type}">
          <span>${ent.type === 'dir' ? '📁' : '📄'} ${escapeHtml(ent.name)}</span>
          <span class="meta">${size}</span>
        </li>`;
      })
      .join('');

    listEl.querySelectorAll('li').forEach((li) => {
      li.onclick = () => {
        const rel = decodeURIComponent(li.getAttribute('data-rel') || '');
        const type = li.getAttribute('data-type');
        if (type === 'dir') {
          hashProjectBrowse(name, rel);
          return;
        }
        const ext = extOf(rel);
        if (IMAGE_EXT.has(ext)) {
          const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
          openImageModal(name, dirRel, rel);
          return;
        }
        hashProjectText(name, rel);
      };
    });
  }

  await refreshExplorer();

  $('#view-dashboard').style.display = 'none';
  $('#view-project').style.display = 'none';
  $('#view-text').style.display = 'none';
  $('#view-browse').style.display = 'flex';
}

/** --- Full-screen text viewer --- */
async function loadTextViewer(name, filePath) {
  showError('');
  wireImageModalOnce();

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    showError('Invalid project name');
    return loadDashboard();
  }

  const parentDir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const browseBack = `#/project/${encodeURIComponent(name)}/browse${parentDir ? `?path=${encodeURIComponent(parentDir)}` : ''}`;

  $('#view-text').innerHTML = `
    <div class="fs-text">
      <div class="fs-text-top">
        <a class="btn secondary" href="${browseBack}">← Browser</a>
        <a class="btn secondary" href="#/project/${encodeURIComponent(name)}">Project</a>
        <span id="fs-text-path" class="fs-text-path"></span>
      </div>
      <pre id="fs-text-area" class="fs-text-area" tabindex="0" spellcheck="false"></pre>
      <div id="fs-text-status" class="viewer-statusbar">—</div>
    </div>`;

  const ta = $('#fs-text-area');
  const statusEl = $('#fs-text-status');
  const pathEl = $('#fs-text-path');

  if (!filePath) {
    pathEl.textContent = '(no file selected)';
    ta.innerHTML = '';
    statusEl.textContent = 'Open a file from the browser.';
    $('#view-dashboard').style.display = 'none';
    $('#view-project').style.display = 'none';
    $('#view-browse').style.display = 'none';
    $('#view-text').style.display = 'flex';
    return;
  }

  pathEl.textContent = filePath;

  try {
    const data = await api(
      `/api/projects/${encodeURIComponent(name)}/view-text?path=${encodeURIComponent(filePath)}`,
    );
    const raw = data.content ?? '';
    ta.innerHTML = linkifyPlainTextToHtml(raw);

    const totalLines = countLines(raw);
    const sizeBytes = typeof data.sizeBytes === 'number' ? data.sizeBytes : new TextEncoder().encode(raw).length;

    function baseStatus() {
      const approx = approxViewportLines(ta);
      const sb = typeof sizeBytes === 'number' ? formatBytes(sizeBytes) : '—';
      return `${sb} · ${totalLines.toLocaleString()} lines · ~${approx} lines in viewport · Click URL to copy · Ctrl/⌘+click to open`;
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
      else refreshStatusBar('Copy failed (clipboard permission?)');
      window.setTimeout(() => refreshStatusBar(), 1600);
    });

    requestAnimationFrame(() => {
      refreshStatusBar();
      requestAnimationFrame(() => refreshStatusBar());
    });
  } catch (e) {
    ta.innerHTML = '';
    statusEl.textContent = e.message || 'Could not load file';
  }

  $('#view-dashboard').style.display = 'none';
  $('#view-project').style.display = 'none';
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'flex';
}

/** --- Project (recon) --- */
async function loadProject(name) {
  showError('');
  wireImageModalOnce();

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    showError('Invalid project name');
    return loadDashboard();
  }

  let files = [];
  try {
    const f = await api(`/api/projects/${encodeURIComponent(name)}/files`);
    files = f.files || [];
  } catch (e) {
    showError(e.message);
    return loadDashboard();
  }

  let keywords = '';
  let blacklist = '';
  try {
    const k = await api(`/api/projects/${encodeURIComponent(name)}/file/keywords.txt`);
    keywords = k.content || '';
  } catch {
    /* */
  }
  try {
    const b = await api(`/api/projects/${encodeURIComponent(name)}/file/blacklist.txt`);
    blacklist = b.content || '';
  } catch {
    /* */
  }

  const fileChips = files.map((f) => `<span class="file-chip">${escapeHtml(f)}</span>`).join('');

  $('#view-project').innerHTML = `
    <div class="panel">
      <h2>Project files</h2>
      <div class="row" style="margin-bottom: 1rem">
        <button type="button" class="secondary" id="btn-save-inputs">Save keywords & blacklist</button>
        <a class="btn secondary" href="#/project/${encodeURIComponent(name)}/browse">Full-screen file browser</a>
      </div>
      <div>${fileChips || '<span class="hint">Empty folder — first save will create files.</span>'}</div>
    </div>
    <div class="panel">
      <h2>Inputs</h2>
      <p class="hint">Prefilled when files exist. On <strong>Start recon</strong>, these are written to the project folder before the run (when scrape/clean steps run).</p>
      <label class="hint" for="fld-keywords">keywords.txt</label>
      <textarea id="fld-keywords" placeholder="# one keyword per line"></textarea>
      <label class="hint" for="fld-blacklist" style="display:block;margin-top:1rem">blacklist.txt</label>
      <textarea id="fld-blacklist" placeholder="# one domain per line"></textarea>
    </div>
    <div class="panel">
      <h2>Start recon</h2>
      <p class="hint">SERP steps use <code>tmp_*</code> files, then merge into canonical results. Use <strong>Stop</strong> to terminate the current subprocess (browser may stay open briefly).</p>
      <div class="chk-wrap">
        <label class="chk"><input type="checkbox" name="step" value="bing" /> Bing</label>
        <label class="chk"><input type="checkbox" name="step" value="duckduckgo" /> DuckDuckGo</label>
        <label class="chk"><input type="checkbox" name="step" value="clean" /> Clean & resolve</label>
        <label class="chk"><input type="checkbox" name="step" value="inspector" /> Inspector</label>
      </div>
      <div class="row">
        <button type="button" id="btn-recon">Start recon</button>
        <button type="button" class="secondary" id="btn-stop-recon" disabled>Stop</button>
      </div>
    </div>
    <div class="panel">
      <h2>Console</h2>
      <pre class="console" id="recon-console"></pre>
    </div>`;

  $('#fld-keywords').value = keywords;
  $('#fld-blacklist').value = blacklist;

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
      appendConsole('[gui] Saved keywords.txt and blacklist.txt\n');
    } catch (e) {
      showError(e.message);
    }
  };

  const consoleEl = $('#recon-console');
  function appendConsole(text) {
    const line = document.createElement('div');
    line.className = 'line';
    line.textContent = text;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  let es = null;
  let currentRunId = null;
  const btnRecon = $('#btn-recon');
  const btnStop = $('#btn-stop-recon');

  btnStop.onclick = async () => {
    if (!currentRunId) return;
    try {
      const r = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/stop`, { method: 'POST' });
      const t = await r.text();
      if (!r.ok) {
        let err = r.statusText;
        try {
          err = JSON.parse(t).error || err;
        } catch {
          /* */
        }
        appendConsole(`[gui] Stop: ${err}\n`);
        return;
      }
      appendConsole('[gui] Stop signal sent.\n');
    } catch (e) {
      appendConsole(`[gui] Stop failed: ${e.message}\n`);
    }
  };

  btnRecon.onclick = async () => {
    const steps = [...document.querySelectorAll('input[name="step"]:checked')].map((x) => x.value);
    if (!steps.length) return showError('Select at least one step');

    const needsKw = steps.some((s) => ['bing', 'duckduckgo', 'clean'].includes(s));
    const kw = $('#fld-keywords').value.trim();
    if (needsKw && !kw) return showError('Keywords required for Bing, DuckDuckGo, or Clean');

    btnRecon.disabled = true;
    btnStop.disabled = false;
    consoleEl.innerHTML = '';
    appendConsole('[gui] Connecting log stream…\n');

    const runId = crypto.randomUUID();
    currentRunId = runId;
    if (es) es.close();
    es = new EventSource(`/api/runs/${runId}/stream`);

    const finishReconUi = () => {
      btnRecon.disabled = false;
      btnStop.disabled = true;
      currentRunId = null;
      if (es) {
        es.close();
        es = null;
      }
    };

    let posted = false;
    es.onopen = async () => {
      if (posted) return;
      posted = true;
      try {
        await api(`/api/projects/${encodeURIComponent(name)}/recon`, {
          method: 'POST',
          body: JSON.stringify({
            runId,
            steps,
            keywords: $('#fld-keywords').value,
            blacklist: $('#fld-blacklist').value,
          }),
        });
      } catch (e) {
        showError(e.message);
        finishReconUi();
      }
    };

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.text) appendConsole(data.text);
        if (data.done) {
          if (data.stopped) {
            appendConsole('\n[gui] Stopped.\n');
          } else if (data.ok) {
            appendConsole('\n[gui] Finished OK\n');
          } else {
            appendConsole(`\n[gui] Finished with error: ${data.message || ''}\n`);
          }
          finishReconUi();
        }
      } catch {
        appendConsole(ev.data + '\n');
      }
    };

    es.onerror = () => {
      if (!posted) appendConsole('\n[gui] Log stream failed to connect\n');
      finishReconUi();
    };
  };

  $('#view-dashboard').style.display = 'none';
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
  $('#view-browse').style.display = 'none';
  $('#view-text').style.display = 'none';

  if (parsed.route === 'dashboard') {
    void loadDashboard();
    return;
  }
  if (parsed.route === 'project') {
    void loadProject(parsed.name);
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
