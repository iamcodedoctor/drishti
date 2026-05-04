// INSPECTOR-GENERAL v1 — Configuration
// Set GHOST_PROJECT_DIR to an absolute project folder (data/<name>) for GUI projects.

import { join } from 'node:path';

const projectRoot = process.env.GHOST_PROJECT_DIR
  ? process.env.GHOST_PROJECT_DIR
  : join(process.cwd(), 'data');

const inspectorConfig = {
  projectRoot,
  input: join(projectRoot, 'cleaned_results.txt'),
  outputDir: join(projectRoot, 'recon'),
  logFile: join(projectRoot, 'logs.txt'),
  captureScreenshots: process.env.DRISHTI_INSPECTOR_SCREENSHOTS !== 'false',

  // How many domains to inspect in parallel (each uses isolated browser contexts).
  concurrency: 3,

  // Random pause after each domain finishes (per worker), before claiming the next job.
  delayBetweenDomains: { min: 1000, max: 3000 },

  // Browser
  browser: {
    headless: true,
    timeout: 30000,
  },

  // Screenshots — device profiles
  devices: [
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'laptop', width: 1366, height: 768 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 812 },
  ],

  // Crawling
  maxInternalLinks: 2,

  // HTTP
  fetchTimeout: 15000,
  linkCheckTimeout: 5000,
};

export default inspectorConfig;
