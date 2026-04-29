// DRISHTI v1 — AI Qualification Engine (OpenAI-compatible LLM)
//
// Reads prefilter.txt and performs three sequential local-LLM steps per domain:
// 1) business classification
// 2) SEO dependency
// 3) optimization gap
//
// Outputs:
// - ai_qualification.txt             (markdown-link + JSON blocks)
// - ai_qualification_cache.json      (cache by domain + input signature)
//
// Runtime:
//   node parser/aiQualification.js --project <name>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { resolveProjectRoot } from '../config.js';
import { info, warn, error as logError } from '../core/logger.js';

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function loadLlmConfig(repoRoot = process.cwd()) {
  const path = join(repoRoot, 'llm.config.json');
  const cfg = readJsonFile(path, {});
  const baseUrl = String(process.env.DRISHTI_LLM_BASE_URL || cfg.baseUrl || 'http://127.0.0.1:1234/v1')
    .trim()
    .replace(/\/+$/, '');
  const apiKey = String(process.env.DRISHTI_LLM_API_KEY || cfg.apiKey || '').trim();
  const model = String(process.env.DRISHTI_LLM_MODEL || cfg.model || 'meta-llama-3.1-8b-instruct').trim();
  const temperature = Number(process.env.DRISHTI_LLM_TEMPERATURE ?? cfg.temperature ?? 0.25);
  const timeoutMs = Number(process.env.DRISHTI_LLM_TIMEOUT_MS ?? cfg.timeoutMs ?? 120000);
  const retries = Number(process.env.DRISHTI_LLM_RETRIES ?? cfg.retries ?? 2);
  const snippetMaxChars = Number(process.env.DRISHTI_AI_SNIPPET_MAX ?? cfg.snippetMaxChars ?? 1000);
  const forceJson = (process.env.DRISHTI_LLM_FORCE_JSON ?? cfg.forceJson ?? true) !== false;
  return {
    baseUrl,
    apiKey,
    model,
    temperature: Number.isFinite(temperature) ? temperature : 0.25,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120000,
    retries: Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : 2,
    snippetMaxChars: Number.isFinite(snippetMaxChars) ? Math.max(200, Math.floor(snippetMaxChars)) : 1000,
    forceJson: !!forceJson,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const projIdx = args.indexOf('--project');
  const projectName = projIdx !== -1 && args[projIdx + 1] ? args[projIdx + 1] : '';
  if (process.env.GHOST_PROJECT_DIR) return { projectRoot: process.env.GHOST_PROJECT_DIR };
  if (!projectName || !PROJECT_NAME_RE.test(projectName)) {
    throw new Error('Usage: node parser/aiQualification.js --project <name>');
  }
  return { projectRoot: resolveProjectRoot(projectName, process.cwd()) };
}

function safeSnippet(text, maxChars) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function readJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function parsePrefilterRecords(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run "Prefilter" first.`);
  }
  const raw = readFileSync(path, 'utf-8');
  const lines = raw.split('\n');
  const records = [];
  const linkRe = /^\[(.+?)\]\((.+?)\)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const m = line.match(linkRe);
    if (!m) continue;

    let j = i + 1;
    while (j < lines.length && !lines[j]?.trim()) j++;
    if (j >= lines.length) break;

    try {
      const rec = JSON.parse(lines[j]);
      records.push(rec);
    } catch {
      /* skip malformed block */
    }
    i = j;
  }

  return records;
}

function signatureForRecord(rec) {
  const stable = {
    domain: rec.domain || '',
    title: rec.title || rec.metrics?.title || '',
    meta: rec.meta || rec.meta_description || '',
    h1: rec.h1 || '',
    content_snippet: safeSnippetForSig(rec.content_snippet || ''),
    pre_score: Number(rec.pre_score || 0),
    flags: Array.isArray(rec.flags) ? rec.flags : [],
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function safeSnippetForSig(text) {
  // Keep cache keys stable even if snippetMaxChars changes.
  return safeSnippet(text, 1000);
}

async function callOpenAiCompatibleJson(llm, prompt) {
  let lastErr = null;
  for (let attempt = 0; attempt <= llm.retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), llm.timeoutMs);
    try {
      const url = `${llm.baseUrl}/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`;
      const baseBody = {
        model: llm.model,
        temperature: llm.temperature,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict JSON generator. Return JSON only. No markdown, no extra text.',
          },
          { role: 'user', content: prompt },
        ],
      };
      const tryOnce = async (withResponseFormat) => {
        const body = { ...baseBody };
        // Some servers accept this, others 400. We'll auto-fallback if needed.
        if (withResponseFormat) body.response_format = { type: 'json_object' };
        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers,
          body: JSON.stringify(body),
        });
        return res;
      };

      let res = await tryOnce(!!llm.forceJson);
      if (!res.ok && res.status === 400 && llm.forceJson) {
        // Retry without response_format on strict 400 servers.
        res = await tryOnce(false);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}${errText ? `: ${errText.slice(0, 400)}` : ''}`);
      }

      const payload = await res.json();
      const text = String(payload?.choices?.[0]?.message?.content || '').trim();
      try {
        return JSON.parse(text);
      } catch (e) {
        lastErr = new Error(`Invalid JSON from LLM: ${e.message}`);
      }
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr || new Error('LLM request failed');
}

function promptStep1({ title, meta, h1, content }) {
  return `Analyze the following website data:

TITLE: ${title}
META: ${meta}
H1: ${h1}
CONTENT: ${content}

Return STRICT JSON only:
{
  "business_type": "ecommerce | local_service | saas | blog | agency | unknown",
  "niche": "",
  "target_audience": "",
  "monetization": "",
  "maturity": "low | medium | high"
}`;
}

function promptStep2({ title, meta, content }) {
  return `Based on this website content:

TITLE: ${title}
META: ${meta}
CONTENT: ${content}

Answer:
1. Does this business rely on organic traffic (Google search) to get customers?
2. Would better SEO significantly improve their business?

Return STRICT JSON only:
{
  "seo_dependency_score": 0,
  "confidence": 0,
  "reason": ""
}`;
}

function promptStep3({ title, meta, h1, flags, content }) {
  return `Evaluate this website:

TITLE: ${title}
META: ${meta}
H1: ${h1}
FLAGS: ${JSON.stringify(flags)}
CONTENT: ${content}

Identify SEO weaknesses.

Return STRICT JSON only:
{
  "optimization_score": 0,
  "issues": ["missing meta description"],
  "severity": "low | medium | high"
}`;
}

function clamp0to100(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function normalizeBusinessStep(step) {
  const allowedType = new Set(['ecommerce', 'local_service', 'saas', 'blog', 'agency', 'unknown']);
  const allowedMaturity = new Set(['low', 'medium', 'high']);
  return {
    business_type: allowedType.has(step?.business_type) ? step.business_type : 'unknown',
    niche: String(step?.niche || '').trim(),
    target_audience: String(step?.target_audience || '').trim(),
    monetization: String(step?.monetization || '').trim(),
    maturity: allowedMaturity.has(step?.maturity) ? step.maturity : 'medium',
  };
}

function normalizeSeoDependencyStep(step) {
  return {
    seo_dependency_score: clamp0to100(step?.seo_dependency_score),
    confidence: clamp0to100(step?.confidence),
    reason: String(step?.reason || '').trim(),
  };
}

function normalizeOptimizationStep(step) {
  const allowedSeverity = new Set(['low', 'medium', 'high']);
  const normalizeIssue = (x) => {
    if (typeof x === 'string') return x.trim();
    if (x && typeof x === 'object') {
      try {
        return JSON.stringify(x);
      } catch {
        return String(x);
      }
    }
    return String(x || '').trim();
  };
  return {
    optimization_score: clamp0to100(step?.optimization_score),
    issues: Array.isArray(step?.issues)
      ? step.issues.map(normalizeIssue).filter(Boolean).slice(0, 12)
      : [],
    severity: allowedSeverity.has(step?.severity) ? step.severity : 'medium',
  };
}

function computeFinalLeadScore(pre_score, seo_dependency_score, optimization_score, confidence) {
  const lead_score =
    (Number(pre_score || 0) * 0.3) +
    (Number(seo_dependency_score || 0) * 0.3) +
    (Number(optimization_score || 0) * 0.3) +
    (Number(confidence || 0) * 0.1);
  return Math.max(0, Math.min(100, Math.round(lead_score)));
}

function classifyLeadStatus(lead_score) {
  if (lead_score >= 70) return 'high_value';
  if (lead_score >= 50) return 'medium_value';
  return 'reject';
}

async function qualifyOne(rec, cache, llm) {
  const domain = String(rec.domain || '').trim().toLowerCase();
  // Support both prefilter output variants:
  // - older: { title, meta_description, h1, content_snippet, pre_score, flags }
  // - newer deterministic: { metrics: { ... }, ... }
  const title = String(rec.title || rec.metrics?.title || rec.metrics?.seo?.title || '').trim();
  const meta = String(
    rec.meta ||
    rec.meta_description ||
    rec.metrics?.meta_description ||
    rec.metrics?.seo?.meta_description ||
    '',
  ).trim();
  const h1 = String(rec.h1 || rec.metrics?.h1 || '').trim();
  const content = safeSnippet(rec.content_snippet || '', llm.snippetMaxChars);
  const pre_score = clamp0to100(rec.pre_score);
  const flags = Array.isArray(rec.flags) ? rec.flags : [];
  const sig = signatureForRecord({ domain, title, meta, h1, content_snippet: content, pre_score, flags });

  const cached = cache[domain];
  if (cached?.signature === sig && cached?.result) {
    return cached.result;
  }

  const step1 = normalizeBusinessStep(await callOpenAiCompatibleJson(llm, promptStep1({ title, meta, h1, content })));
  const step2 = normalizeSeoDependencyStep(await callOpenAiCompatibleJson(llm, promptStep2({ title, meta, content })));
  const step3 = normalizeOptimizationStep(await callOpenAiCompatibleJson(llm, promptStep3({ title, meta, h1, flags, content })));

  const lead_score = computeFinalLeadScore(
    pre_score,
    step2.seo_dependency_score,
    step3.optimization_score,
    step2.confidence,
  );
  const status = classifyLeadStatus(lead_score);

  const result = {
    domain,
    lead_score,
    status,
    business_type: step1.business_type,
    niche: step1.niche,
    target_audience: step1.target_audience,
    monetization: step1.monetization,
    maturity: step1.maturity,
    seo_dependency_score: step2.seo_dependency_score,
    confidence: step2.confidence,
    optimization_score: step3.optimization_score,
    severity: step3.severity,
    issues: step3.issues,
    reason: step2.reason || `Business appears ${step1.business_type} with SEO opportunity scored at ${step3.optimization_score}.`,
    source: {
      pre_score,
      flags,
      title,
      meta,
      h1,
      content_snippet: content,
    },
  };

  cache[domain] = {
    signature: sig,
    updated_at: new Date().toISOString(),
    result,
  };

  return result;
}

async function verifyLlmReachable(llm) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `${llm.baseUrl}/models`;
    const headers = {};
    if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  } catch (e) {
    throw new Error(`LLM not reachable at ${llm.baseUrl} (GET /models).`);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const { projectRoot } = parseArgs();
  const llm = loadLlmConfig(process.cwd());
  const prefilterPath = join(projectRoot, 'prefilter.txt');
  const outputPath = join(projectRoot, 'ai_qualification.txt');
  const cachePath = join(projectRoot, 'ai_qualification_cache.json');

  info('AI_QUAL', `Starting. projectRoot=${projectRoot}`);
  info('AI_QUAL', `LLM model=${llm.model} | baseUrl=${llm.baseUrl}`);
  await verifyLlmReachable(llm);

  const records = parsePrefilterRecords(prefilterPath);
  info('AI_QUAL', `Loaded ${records.length} prefilter record(s)`);
  if (records.length === 0) {
    warn('AI_QUAL', 'No records in prefilter.txt. Exiting.');
    writeFileSync(outputPath, '', 'utf-8');
    return;
  }

  const cache = readJsonFile(cachePath, {});
  const results = [];

  // Process domains sequentially as requested.
  for (let i = 0; i < records.length; i++) {
    const domain = records[i]?.domain || `domain_${i + 1}`;
    info('AI_QUAL', `[${i + 1}/${records.length}] ${domain}`);
    const result = await qualifyOne(records[i], cache, llm);
    results.push(result);
    writeJsonFile(cachePath, cache);
  }

  const blocks = [];
  for (const rec of results.sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0))) {
    blocks.push(`[${rec.domain}](https://${rec.domain})`);
    blocks.push(JSON.stringify(rec));
    blocks.push('');
  }
  writeFileSync(outputPath, blocks.join('\n'), 'utf-8');

  const counts = results.reduce((acc, rec) => {
    acc[rec.status] = (acc[rec.status] || 0) + 1;
    return acc;
  }, {});
  info(
    'AI_QUAL',
    `Wrote ${results.length} record(s) -> ${outputPath} | high=${counts.high_value || 0}, medium=${counts.medium_value || 0}, reject=${counts.reject || 0}`,
  );
}

main().catch((e) => {
  logError('AI_QUAL', `Fatal: ${e.message}`);
  process.exit(1);
});

