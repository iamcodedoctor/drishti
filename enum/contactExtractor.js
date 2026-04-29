// INSPECTOR-GENERAL v1 — LLM Contact Extractor
// Brute-forces contact pages and uses a local LLM to extract information.

import * as cheerio from 'cheerio';
import { info, debug, warn, error as logError } from '../inspector/core/logger.js';
import llmConfig from './config.js';
import inspectorConfig from '../inspector/config.js';

const CONTACT_PATHS = [
  '/', // Homepage often has footer info
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/team',
  '/our-team',
  '/leadership',
  '/management',
  '/company',
  '/support',
  '/help',
];

/**
 * Strips HTML tags and excessive whitespace to save LLM tokens.
 */
function extractTextFromHtml(html) {
  const $ = cheerio.load(html);
  // Remove scripts, styles, noscript
  $('script, style, noscript, svg, img').remove();
  let text = $('body').text();
  // Compress whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Truncate to avoid blowing up context window (roughly 15000 chars ~ 3000 tokens)
  if (text.length > 20000) {
    text = text.substring(0, 20000);
  }
  return text;
}

/**
 * Fetch a URL and return text if status is 2xx.
 */
async function fetchPageText(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), inspectorConfig.fetchTimeout || 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    // Only process 200 series responses
    if (response.ok) {
      const html = await response.text();
      return extractTextFromHtml(html);
    }
  } catch (err) {
    // Ignore fetch errors (404s, timeouts etc.) for brute-forcing
  }
  return null;
}

/**
 * Query the local LLM to extract data from text.
 */
async function queryLLM(text, domain) {
  if (!text || text.length < 50) return null;

  try {
    const payload = {
      model: llmConfig.modelName,
      messages: [
        { role: 'system', content: llmConfig.systemPrompt },
        { role: 'user', content: `Extract contact info from this website text:\n\n${text}` }
      ],
      temperature: llmConfig.temperature,
      max_tokens: llmConfig.maxTokens
    };

    const response = await fetch(llmConfig.modelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      warn(domain, `LLM API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    
    if (rawContent) {
      try {
        // Find JSON block if LLM added markdown despite instructions
        let jsonStr = rawContent.trim();
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
        return JSON.parse(jsonStr);
      } catch (parseErr) {
        warn(domain, `Failed to parse LLM JSON: ${parseErr.message}`);
        debug(domain, `Raw LLM output: ${rawContent}`);
      }
    }
  } catch (err) {
    warn(domain, `LLM request failed: ${err.message}`);
  }
  return null;
}

/**
 * Merge two extracted objects, deduplicating arrays.
 */
function mergeExtraction(base, newData) {
  if (!newData) return base;
  
  const merged = { ...base };
  
  if (!merged.company_name && newData.company_name) {
    merged.company_name = newData.company_name;
  }
  
  if (newData.emails && Array.isArray(newData.emails)) {
    merged.emails = [...new Set([...merged.emails, ...newData.emails])];
  }
  
  if (newData.contact_numbers && Array.isArray(newData.contact_numbers)) {
    // Dedupe by number stripping non-digits
    const existingNumbers = new Set(merged.contact_numbers.map(n => typeof n === 'string' ? n.replace(/\D/g, '') : (n.number ? n.number.replace(/\D/g, '') : '')));
    for (const item of newData.contact_numbers) {
      let numStr = typeof item === 'string' ? item : item.number;
      if (numStr) {
        let cleanNum = numStr.replace(/\D/g, '');
        if (!existingNumbers.has(cleanNum)) {
          merged.contact_numbers.push(typeof item === 'string' ? { number: item, context: 'Unknown' } : item);
          existingNumbers.add(cleanNum);
        }
      }
    }
  }
  
  if (newData.key_people && Array.isArray(newData.key_people)) {
    // Simple dedupe by name
    const existingNames = new Set(merged.key_people.map(p => p.name?.toLowerCase()));
    for (const person of newData.key_people) {
      if (person.name && !existingNames.has(person.name.toLowerCase())) {
        merged.key_people.push(person);
        existingNames.add(person.name.toLowerCase());
      }
    }
  }
  
  return merged;
}

/**
 * Main entry point: Brute force contact paths and extract via LLM.
 */
export async function extractContactsWithLLM(baseUrl, domain) {
  info(domain, `Starting LLM contact extraction (brute-forcing paths)`);
  
  let finalResult = {
    company_name: null,
    emails: [],
    contact_numbers: [],
    key_people: []
  };

  const base = baseUrl.replace(/\/$/, ''); // Remove trailing slash

  for (const path of CONTACT_PATHS) {
    const targetUrl = `${base}${path}`;
    debug(domain, `Trying contact path: ${targetUrl}`);
    
    const textContent = await fetchPageText(targetUrl);
    
    if (textContent) {
      debug(domain, `Successfully fetched ${path}, querying LLM...`);
      const extractedData = await queryLLM(textContent, domain);
      
      if (extractedData) {
         finalResult = mergeExtraction(finalResult, extractedData);
      }
    }
  }
  
  info(domain, `Extracted contacts: ${finalResult.emails.length} emails, ${finalResult.contact_numbers.length} numbers, ${finalResult.key_people.length} key people.`);
  
  return finalResult;
}
