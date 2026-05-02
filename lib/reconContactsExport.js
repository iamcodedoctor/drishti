// Aggregate recon/<domain>/contacts.json rows for CSV / styled XLSX export.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Subtle grid — visible on green/yellow/white fills */
const GRID_BORDER = {
  top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
};

function loadWatermarkPng() {
  try {
    return readFileSync(join(__dirname, 'rank-aeo-watermark.png'));
  } catch {
    return null;
  }
}

const HEADERS = [
  'Domain',
  'Company name',
  'Emails',
  'Phone numbers',
  'Key people',
  'Homepage load (ms)',
  'Homepage links',
  'Broken links',
  'Issues detected',
];

/** @param {unknown} v */
function strTrim(v) {
  if (v == null) return '';
  return String(v).trim();
}

/** @param {unknown} arr */
function formatEmails(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map((e) => strTrim(e)).filter(Boolean).join('; ');
}

/** @param {unknown} arr */
function formatPhones(arr) {
  if (!Array.isArray(arr)) return '';
  const parts = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const s = strTrim(item);
      if (s) parts.push(s);
      continue;
    }
    if (item && typeof item === 'object') {
      const n = strTrim(/** @type {{ number?: string }} */ (item).number);
      const c = strTrim(/** @type {{ context?: string }} */ (item).context);
      if (n) parts.push(c ? `${n} (${c})` : n);
    }
  }
  return parts.join('; ');
}

/** @param {unknown} arr */
function formatPeople(arr) {
  if (!Array.isArray(arr)) return '';
  const parts = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const name = strTrim(/** @type {{ name?: string }} */ (p).name);
    if (!name) continue;
    const role = strTrim(/** @type {{ role?: string }} */ (p).role);
    parts.push(role ? `${name} — ${role}` : name);
  }
  return parts.join('; ');
}

/** @param {unknown} data */
function hasEmails(data) {
  if (!data || typeof data !== 'object') return false;
  const emails = /** @type {{ emails?: unknown }} */ (data).emails;
  if (!Array.isArray(emails)) return false;
  return emails.some((e) => strTrim(e));
}

/** @param {unknown} data */
function hasPhones(data) {
  if (!data || typeof data !== 'object') return false;
  const nums = /** @type {{ contact_numbers?: unknown }} */ (data).contact_numbers;
  if (!Array.isArray(nums)) return false;
  for (const item of nums) {
    if (typeof item === 'string' && strTrim(item)) return true;
    if (item && typeof item === 'object' && strTrim(/** @type {{ number?: string }} */ (item).number)) return true;
  }
  return false;
}

/** @param {unknown} data */
function hasKeyPeople(data) {
  if (!data || typeof data !== 'object') return false;
  const people = /** @type {{ key_people?: unknown }} */ (data).key_people;
  if (!Array.isArray(people)) return false;
  return people.some((p) => p && typeof p === 'object' && strTrim(/** @type {{ name?: string }} */ (p).name));
}

/** @param {unknown} data */
function hasCompany(data) {
  if (!data || typeof data !== 'object') return false;
  return !!strTrim(/** @type {{ company_name?: unknown }} */ (data).company_name);
}

/**
 * Inspector outputs: performance.json + seo_report.json (see inspector/output/reporter.js).
 * @param {unknown} perf
 * @param {unknown} seo
 * @returns {{ loadMs: number | null, homepageLinks: number | null, brokenLinks: number | null, issuesDetected: number | null }}
 */
function extractInspectorMetrics(perf, seo) {
  /** @type {number | null} */
  let loadMs = null;
  if (perf && typeof perf === 'object') {
    const n = Number(/** @type {{ load_time_ms?: unknown }} */ (perf).load_time_ms);
    if (Number.isFinite(n)) loadMs = Math.round(n);
  }

  /** @type {number | null} */
  let homepageLinks = null;
  /** @type {number | null} */
  let brokenLinks = null;
  /** @type {number | null} */
  let issuesDetected = null;

  if (seo && typeof seo === 'object') {
    const s = /** @type {{ links?: { internal?: { count?: unknown }; external?: { count?: unknown }; broken?: unknown }; issues?: unknown }} */ (seo);
    const int = Number(s.links?.internal?.count);
    const ext = Number(s.links?.external?.count);
    homepageLinks = (Number.isFinite(int) ? int : 0) + (Number.isFinite(ext) ? ext : 0);
    brokenLinks = Array.isArray(s.links?.broken) ? s.links.broken.length : 0;
    issuesDetected = Array.isArray(s.issues) ? s.issues.length : 0;
  }

  return { loadMs, homepageLinks, brokenLinks, issuesDetected };
}

/**
 * @param {string} domain
 * @param {unknown} data parsed contacts.json or null
 * @param {unknown} perf parsed performance.json or null
 * @param {unknown} seo parsed seo_report.json or null
 */
export function flattenReconRow(domain, data, perf = null, seo = null) {
  const company = data && typeof data === 'object' ? strTrim(/** @type {{ company_name?: unknown }} */ (data).company_name) : '';
  const emails = formatEmails(data && typeof data === 'object' ? /** @type {{ emails?: unknown }} */ (data).emails : []);
  const phones = formatPhones(
    data && typeof data === 'object' ? /** @type {{ contact_numbers?: unknown }} */ (data).contact_numbers : [],
  );
  const people = formatPeople(data && typeof data === 'object' ? /** @type {{ key_people?: unknown }} */ (data).key_people : []);

  const he = hasEmails(data);
  const hp = hasPhones(data);
  const hk = hasKeyPeople(data);
  const hc = hasCompany(data);

  let category;
  if (!he && !hp) {
    category = 'nocontact';
  } else if (hc && he && hp && hk) {
    category = 'complete';
  } else {
    category = 'partial';
  }

  const { loadMs, homepageLinks, brokenLinks, issuesDetected } = extractInspectorMetrics(perf, seo);

  return {
    domain,
    company,
    emails,
    phones,
    people,
    category,
    loadMs,
    homepageLinks,
    brokenLinks,
    issuesDetected,
  };
}

/**
 * @param {string} reconAbsPath absolute path to project/recon
 * @returns {ReturnType<typeof flattenReconRow>[]}
 */
export function collectReconContactRows(reconAbsPath) {
  if (!existsSync(reconAbsPath) || !statSync(reconAbsPath).isDirectory()) {
    return [];
  }
  const names = readdirSync(reconAbsPath).filter((f) => !f.startsWith('.'));
  const out = [];
  for (const domain of names) {
    const dirPath = join(reconAbsPath, domain);
    let st;
    try {
      st = statSync(dirPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const cPath = join(dirPath, 'contacts.json');
    /** @type {unknown} */
    let data = null;
    if (existsSync(cPath) && statSync(cPath).isFile()) {
      try {
        data = JSON.parse(readFileSync(cPath, 'utf-8'));
      } catch {
        data = null;
      }
    }

    /** @type {unknown} */
    let perf = null;
    const perfPath = join(dirPath, 'performance.json');
    if (existsSync(perfPath) && statSync(perfPath).isFile()) {
      try {
        perf = JSON.parse(readFileSync(perfPath, 'utf-8'));
      } catch {
        perf = null;
      }
    }

    /** @type {unknown} */
    let seo = null;
    const seoPath = join(dirPath, 'seo_report.json');
    if (existsSync(seoPath) && statSync(seoPath).isFile()) {
      try {
        seo = JSON.parse(readFileSync(seoPath, 'utf-8'));
      } catch {
        seo = null;
      }
    }

    out.push(flattenReconRow(domain, data, perf, seo));
  }
  out.sort((a, b) => a.domain.localeCompare(b.domain));
  return out;
}

/** Escape one CSV field */
function csvField(s) {
  const t = String(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/**
 * Emails / phones / key people are joined with "; " for CSV — Excel uses one line per entry.
 * @param {string} semicolonJoined
 */
function excelMultilineContacts(semicolonJoined) {
  const t = String(semicolonJoined ?? '').trim();
  if (!t) return '';
  return t.split('; ').join('\n');
}

/**
 * @param {ReturnType<typeof flattenReconRow>[]} rows
 */
export function buildReconContactsCsv(rows) {
  const lines = [HEADERS.map(csvField).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.domain,
        r.company,
        r.emails,
        r.phones,
        r.people,
        r.loadMs == null ? '' : String(r.loadMs),
        r.homepageLinks == null ? '' : String(r.homepageLinks),
        r.brokenLinks == null ? '' : String(r.brokenLinks),
        r.issuesDetected == null ? '' : String(r.issuesDetected),
      ]
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

const FILL_HEADER = 'FF1E3A5F';
const FILL_COMPLETE = 'FFE8F5E9';
const FILL_NOCONTACT = 'FFFFFDE7';

/**
 * @param {ReturnType<typeof flattenReconRow>[]} rows
 */
export async function buildReconContactsXlsxBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DRISHTI';
  const ws = wb.addWorksheet('Recon contacts', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const wmBuf = loadWatermarkPng();
  if (wmBuf) {
    const wmId = wb.addImage({ buffer: wmBuf, extension: 'png' });
    ws.addBackgroundImage(wmId);
  }

  ws.headerFooter.oddHeader = '&C&K9CA3AF&I&"Calibri"&14RANK AEO Confidential';

  ws.addRow(HEADERS);
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: FILL_HEADER },
    };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = GRID_BORDER;
  });

  for (const r of rows) {
    const row = ws.addRow([
      r.domain,
      r.company,
      excelMultilineContacts(r.emails),
      excelMultilineContacts(r.phones),
      excelMultilineContacts(r.people),
      r.loadMs == null ? '' : r.loadMs,
      r.homepageLinks == null ? '' : r.homepageLinks,
      r.brokenLinks == null ? '' : r.brokenLinks,
      r.issuesDetected == null ? '' : r.issuesDetected,
    ]);
    const fillArgb = r.category === 'complete' ? FILL_COMPLETE : r.category === 'nocontact' ? FILL_NOCONTACT : null;
    row.eachCell((cell) => {
      if (fillArgb) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillArgb },
        };
      }
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { size: 11 };
      cell.border = GRID_BORDER;
    });
  }

  ws.columns = [
    { width: 30 },
    { width: 32 },
    { width: 40 },
    { width: 44 },
    { width: 44 },
    { width: 18 },
    { width: 16 },
    { width: 14 },
    { width: 16 },
  ];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
