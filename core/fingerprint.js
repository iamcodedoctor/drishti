// DRISHTI v1 — Fingerprint Generator
// Generates CONSISTENT, realistic browser fingerprints.
// Key principle: all fingerprint components must be internally consistent.
// A Windows UA with an Asia/Tokyo timezone and en-US locale is suspicious.
// A Linux UA with Asia/Kolkata timezone and en-IN locale is believable.

import { platform } from 'node:os';

/**
 * Consistent fingerprint profiles — each profile has matching UA, timezone, locale.
 * Google cross-checks these signals. Inconsistency = CAPTCHA.
 */
const PROFILES = [
  // Linux profiles (for Linux hosts — matches actual OS platform)
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    platform: 'linux',
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    platform: 'linux',
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    platform: 'linux',
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    platform: 'linux',
  },
  // Windows profiles (fallback for Windows hosts)
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    timezone: 'America/New_York',
    locale: 'en-US',
    platform: 'win32',
  },
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    timezone: 'America/Chicago',
    locale: 'en-US',
    platform: 'win32',
  },
  // macOS profiles (fallback for Mac hosts)
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    timezone: 'America/Los_Angeles',
    locale: 'en-US',
    platform: 'darwin',
  },
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
  { width: 1680, height: 1050 },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Detect the actual OS platform and return matching profiles.
 */
function getMatchingProfiles() {
  const os = platform(); // 'linux', 'win32', 'darwin'
  const matching = PROFILES.filter((p) => p.platform === os);
  // Fallback to all profiles if no OS match
  return matching.length > 0 ? matching : PROFILES;
}

/**
 * Generate a consistent, realistic browser fingerprint.
 * Matches UA platform to actual OS to avoid Google's cross-check detection.
 * @returns {{ userAgent: string, viewport: {width: number, height: number}, timezone: string, locale: string }}
 */
export function generateFingerprint() {
  const profiles = getMatchingProfiles();
  const profile = pick(profiles);

  return {
    userAgent: profile.userAgent,
    viewport: pick(VIEWPORTS),
    timezone: profile.timezone,
    locale: profile.locale,
  };
}
