import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import config, { applyProjectByName } from '../config.js';
import { info, error as logError } from '../core/logger.js';

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const BLOG_PATTERNS = [
  'blog', 'resources', 'news', 'articles', 'insights', 
  'guides', 'tutorials', 'case-studies', 'journal', 
  'updates', 'stories', 'publications'
];

function parseArgs() {
  const args = process.argv.slice(2);
  const projIdx = args.indexOf('--project');
  
  if (projIdx !== -1 && args[projIdx + 1]) {
    const name = args[projIdx + 1];
    if (!PROJECT_NAME_RE.test(name)) {
      console.error('Error: invalid --project name.');
      process.exit(1);
    }
    applyProjectByName(name);
    return { projectName: name };
  }
  console.error('Error: --project is required.');
  process.exit(1);
}

function parseCleanedResults(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  const domains = new Set();
  
  for (const line of content.split('\n')) {
    const match = line.match(/^\[\w+\]\s+.+?\s*\|\s*\d+\s*\|\s*(.+?)\s*\|\s*(.+)$/);
    if (match) {
      domains.add(match[1].trim());
    }
  }
  return Array.from(domains);
}

async function fetchHtml(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) return '';
    return await response.text();
  } catch (error) {
    return '';
  }
}

function analyzeHtml(html) {
  const result = {
    blogsExist: 'No',
    linkedIn: ''
  };
  
  if (!html) return result;

  // Extract all hrefs
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  
  while ((match = hrefRegex.exec(html)) !== null) {
    const link = match[1].toLowerCase();
    
    // Check for blogs/resources
    if (result.blogsExist === 'No' && BLOG_PATTERNS.some(p => link.includes(p))) {
      result.blogsExist = 'Yes';
    }
    
    // Check for LinkedIn
    if (result.linkedIn === '' && link.includes('linkedin.com/')) {
      result.linkedIn = match[1]; // Use original case for the link
    }
    
    if (result.blogsExist === 'Yes' && result.linkedIn !== '') {
      break; // No need to check further if we found both
    }
  }
  
  return result;
}

function escapeCsv(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const { projectName } = parseArgs();
  
  info('ENRICH', `Starting enrichment for project: ${projectName}`);
  
  const domains = parseCleanedResults(config.paths.cleanedResults);
  if (domains.length === 0) {
    info('ENRICH', 'No domains found to enrich. Please run the clean step first.');
    process.exit(0);
  }
  
  info('ENRICH', `Found ${domains.length} domains to process.`);
  
  const results = [];
  
  // Process in batches to avoid overwhelming the network
  const batchSize = 10;
  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (domain) => {
      // Try HTTPS first
      const url = `https://${domain}`;
      info('ENRICH', `Fetching ${url}...`);
      
      let html = await fetchHtml(url);
      
      // Fallback to HTTP if HTTPS fails
      if (!html) {
        info('ENRICH', `Fetching http://${domain}...`);
        html = await fetchHtml(`http://${domain}`);
      }
      
      const analysis = analyzeHtml(html);
      return {
        domain,
        blogsExist: analysis.blogsExist,
        linkedIn: analysis.linkedIn
      };
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    info('ENRICH', `Processed ${Math.min(i + batchSize, domains.length)}/${domains.length} domains.`);
  }
  
  // Write updated domains.csv
  const csvLines = ['Domain,Blogs Exist,LinkedIn Profile'];
  for (const row of results) {
    csvLines.push(`${escapeCsv(row.domain)},${escapeCsv(row.blogsExist)},${escapeCsv(row.linkedIn)}`);
  }
  
  const csvPath = join(config.paths.dataDir, 'domains.csv');
  writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf-8');
  
  info('ENRICH', `Enrichment complete. Results saved to ${csvPath}`);
}

main().catch(err => {
  logError('ENRICH', `Fatal error: ${err.message}`);
  process.exit(1);
});
