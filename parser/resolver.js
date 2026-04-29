// DRISHTI v1 — URL Resolver
// Decodes Bing tracking URLs to extract the real destination URL.
// Bing wraps all result links as: bing.com/ck/a?...&u=a1<base64_encoded_url>&...
// The real URL is base64-encoded in the `u` parameter after stripping the 'a1' prefix.

/**
 * Decode a Bing tracking URL to the real destination.
 * @param {string} bingUrl - The bing.com/ck/a tracking URL
 * @returns {string} The real destination URL
 */
export function resolveBingUrl(bingUrl) {
  try {
    const url = new URL(bingUrl);

    // Extract the 'u' parameter
    const uParam = url.searchParams.get('u');
    if (!uParam) return bingUrl;

    // Strip the 'a1' prefix that Bing adds
    const encoded = uParam.startsWith('a1') ? uParam.slice(2) : uParam;

    // Decode base64 (Bing uses URL-safe base64)
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

    const decoded = Buffer.from(padded, 'base64').toString('utf-8');

    // Validate it looks like a URL
    if (decoded.startsWith('http')) {
      return decoded;
    }

    return bingUrl;
  } catch {
    return bingUrl;
  }
}

/**
 * Check if a URL is a Bing tracking redirect.
 * @param {string} url
 * @returns {boolean}
 */
export function isBingTrackingUrl(url) {
  return url.includes('bing.com/ck/a');
}

/**
 * Decode Google SERP redirect wrappers (/url?q=… or /url?url=…).
 * @param {string} rawUrl
 * @returns {string}
 */
export function resolveGoogleUrl(rawUrl) {
  try {
    const base = rawUrl.startsWith('http') ? undefined : 'https://www.google.com';
    const u = new URL(rawUrl, base);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'google.com') return rawUrl;
    if (u.pathname !== '/url') return rawUrl;

    const q = u.searchParams.get('q');
    if (q && /^https?:\/\//i.test(q)) return decodeURIComponent(q);

    const nested = u.searchParams.get('url');
    if (nested && /^https?:\/\//i.test(nested)) return decodeURIComponent(nested);

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isGoogleRedirectUrl(url) {
  try {
    const u = new URL(url, 'https://www.google.com');
    const host = u.hostname.replace(/^www\./, '');
    return host === 'google.com' && u.pathname === '/url';
  } catch {
    return false;
  }
}

/**
 * Resolve any URL — if it's a Bing tracking URL, decode it. Otherwise return as-is.
 * @param {string} url
 * @returns {string}
 */
export function resolveUrl(url) {
  if (isBingTrackingUrl(url)) {
    return resolveBingUrl(url);
  }
  if (isGoogleRedirectUrl(url)) {
    return resolveGoogleUrl(url);
  }
  return url;
}
