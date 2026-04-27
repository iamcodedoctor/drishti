// DRISHTI v1 — Main Entry Point
// CLI: node main.js --engine <bing|duckduckgo> [--output <dir> | --project <name> [--tmp-run] [--truncate-tmp]]

import { readFileSync, mkdirSync, writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { info, error as logError } from './core/logger.js';
import config, { applyProjectByName, applyTmpResultPaths } from './config.js';

import { runBing } from './engines/bing.js';
import { runDuckDuckGo } from './engines/duckduckgo.js';

const ENGINE_MAP = {
  bing: runBing,
  duckduckgo: runDuckDuckGo,
  duck: runDuckDuckGo,
};

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/**
 * Parse CLI args.
 * @returns {{ engine: string, outputDir: string|null, projectName: string|null, tmpRun: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);

  const engineIndex = args.indexOf('--engine');
  if (engineIndex === -1 || !args[engineIndex + 1]) {
    console.error(
      'Usage: node main.js --engine <bing|duckduckgo> [--output <dir> | --project <name> [--tmp-run]]',
    );
    process.exit(1);
  }
  const engine = args[engineIndex + 1].toLowerCase();
  if (!ENGINE_MAP[engine]) {
    console.error(`Unknown engine: "${engine}". Available: bing, duckduckgo`);
    process.exit(1);
  }

  const outputIndex = args.indexOf('--output');
  const projectIndex = args.indexOf('--project');
  let outputDir = null;
  let projectName = null;

  if (outputIndex !== -1 && args[outputIndex + 1]) {
    outputDir = args[outputIndex + 1];
  }
  if (projectIndex !== -1 && args[projectIndex + 1]) {
    projectName = args[projectIndex + 1];
  }

  if (outputDir && projectName) {
    console.error('Error: use either --output or --project, not both.');
    process.exit(1);
  }

  if (projectName && !PROJECT_NAME_RE.test(projectName)) {
    console.error('Error: invalid --project name (use letters, digits, ._- only).');
    process.exit(1);
  }

  const tmpRun = args.includes('--tmp-run');
  const truncateTmp = args.includes('--truncate-tmp');

  return { engine, outputDir, projectName, tmpRun, truncateTmp };
}

/**
 * Apply custom output directory to config paths.
 */
function applyOutputDir(outputDir) {
  if (!outputDir) return;

  mkdirSync(outputDir, { recursive: true });

  config.paths.dataDir = outputDir;
  config.paths.rawResults = join(outputDir, 'raw_results.txt');
  config.paths.cleanedResults = join(outputDir, 'cleaned_results.txt');
  config.paths.logs = join(outputDir, 'logs.txt');

  info('MAIN', `Custom output directory: ${outputDir}`);
}

/**
 * Load keywords from file.
 */
function loadKeywords() {
  try {
    const raw = readFileSync(config.paths.keywords, 'utf-8');
    const keywords = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    info('MAIN', `Loaded ${keywords.length} keywords from ${config.paths.keywords}`);
    return keywords;
  } catch (err) {
    logError('MAIN', `Failed to load keywords: ${err.message}`);
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────
async function main() {
  const { engine, outputDir, projectName, tmpRun, truncateTmp } = parseArgs();

  if (projectName) {
    applyProjectByName(projectName);
    if (tmpRun) {
      applyTmpResultPaths();
      if (truncateTmp) {
        const raw = config.paths.rawResults;
        const logs = config.paths.logs;
        try {
          const fh = openSync(raw, 'w');
          closeSync(fh);
        } catch {
          mkdirSync(dirname(raw), { recursive: true });
          writeFileSync(raw, '', 'utf-8');
        }
        try {
          const fh = openSync(logs, 'w');
          closeSync(fh);
        } catch {
          mkdirSync(dirname(logs), { recursive: true });
          writeFileSync(logs, '', 'utf-8');
        }
      }
    }
    info('MAIN', `Project: ${projectName} | tmp-run=${tmpRun}`);
  } else {
    applyOutputDir(outputDir);
    if (tmpRun) {
      console.error('--tmp-run requires --project');
      process.exit(1);
    }
  }

  if (!existsSync(config.paths.keywords)) {
    logError('MAIN', `Keywords file missing: ${config.paths.keywords}`);
    process.exit(1);
  }

  const keywords = loadKeywords();
  if (keywords.length === 0) {
    logError('MAIN', 'No keywords to run (file empty or only comments).');
    process.exit(1);
  }

  info('MAIN', `═══════════════════════════════════════`);
  info('MAIN', `  DRISHTI v1 — Engine: ${engine.toUpperCase()}`);
  info('MAIN', `  Keywords: ${keywords.length}`);
  info('MAIN', `  Output: ${config.paths.rawResults}`);
  info('MAIN', `═══════════════════════════════════════`);

  const start = Date.now();

  try {
    await ENGINE_MAP[engine](keywords);
  } catch (err) {
    logError('MAIN', `Fatal error: ${err.message}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  info('MAIN', `Completed in ${elapsed}s`);
}

main();
