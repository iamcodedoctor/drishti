// ENUM v1 — LLM Enumeration Phase
// Runs independent contact extraction logic.

import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseDomains } from '../inspector/input/parser.js';
import { extractContactsWithLLM } from './contactExtractor.js';
import { info, error as logError, warn } from '../inspector/core/logger.js';

const projectRoot = process.env.GHOST_PROJECT_DIR || join(process.cwd(), 'data');
const inputFile = join(projectRoot, 'cleaned_results.txt');
const outputDir = join(projectRoot, 'recon');

async function main() {
  info('ENUM', '═══════════════════════════════════════');
  info('ENUM', '  ENUM-GENERAL v1 — STARTING');
  info('ENUM', '═══════════════════════════════════════');

  let domains;
  try {
    domains = parseDomains(inputFile);
    info('ENUM', `Loaded ${domains.length} unique domains for enumeration.`);
  } catch (err) {
    warn('ENUM', `Could not read ${inputFile}: ${err.message}`);
    return;
  }

  if (domains.length === 0) {
    warn('ENUM', 'No domains to process. Exiting.');
    return;
  }

  // Create enum output base dir
  mkdirSync(outputDir, { recursive: true });

  // Run sequentially for now (could add concurrency later)
  for (let i = 0; i < domains.length; i++) {
    const { domain, url } = domains[i];
    info('ENUM', `\n[${i + 1}/${domains.length}] Enumerating: ${domain}`);
    
    const domainDir = join(outputDir, domain);
    mkdirSync(domainDir, { recursive: true });

    try {
      const contactsData = await extractContactsWithLLM(url, domain);
      
      if (contactsData) {
        const filePath = join(domainDir, 'contacts.json');
        writeFileSync(filePath, JSON.stringify(contactsData, null, 2), 'utf-8');
        info(domain, `✅ Saved contacts.json`);
      } else {
        warn(domain, `No data extracted.`);
      }
    } catch (err) {
      logError(domain, `Failed to enumerate: ${err.message}`);
    }
  }

  info('ENUM', '═══════════════════════════════════════');
  info('ENUM', '  ENUM-GENERAL v1 — COMPLETE');
  info('ENUM', '═══════════════════════════════════════');
}

main().catch((err) => logError('ENUM', `Unhandled exception: ${err.message}`));
