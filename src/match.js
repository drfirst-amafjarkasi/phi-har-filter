import { isAllowedDomain } from './domains.js';

/** @typedef {'patient'|'provider'|'unknown'} UrlContext */
/** @typedef {'fetch'|'xhr'|'document'|'script'|'stylesheet'|'image'|'font'|'other'} ResourceType */

/**
 * Parse a URL string using the WHATWG URL API.
 * If the URL has no scheme, prepend 'https://' and retry.
 * Returns null on parse failure.
 * Rejects special schemes like data:, blob:, about:
 *
 * @param {string} url
 * @returns {URL|null}
 */
export function parseEntryUrl(url) {
  if (!url || typeof url !== 'string') return null;

  // Reject special/opaque schemes that aren't HTTP(S)
  if (url.match(/^(data|blob|about):/i)) {
    return null;
  }

  try {
    return new URL(url);
  } catch {
    // Try prepending https:// if no scheme
    if (!url.match(/^[a-z][a-z0-9+.-]*:/i)) {
      try {
        return new URL('https://' + url);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Detect URL context (patient/provider/unknown) from pathname.
 * Uses word-boundary checks to avoid false positives:
 * - /patient(s)/ or /member(s)/ etc. → patient context
 * - /prescriber(s)/ or /provider(s)/ etc. → provider context
 *
 * @param {string} pathname - e.g. '/api/v2/patient/123'
 * @returns {UrlContext}
 */
export function detectUrlContext(pathname) {
  if (!pathname || typeof pathname !== 'string') return 'unknown';

  const lower = pathname.toLowerCase();

  // Patient context: word boundaries before/after
  const patientPattern =
    /\/(patient|patients|member|members|beneficiary|beneficiaries|subscriber|subscribers|enrollee|enrollees|person|persons)(\/|$)/;
  if (patientPattern.test(lower)) {
    return 'patient';
  }

  // Provider context: word boundaries
  const providerPattern =
    /\/(prescriber|prescribers|provider|providers|clinician|clinicians|npi|physician|physicians|hcp|hcps)(\/|$)/;
  if (providerPattern.test(lower)) {
    return 'provider';
  }

  return 'unknown';
}

/**
 * Infer resource type from HAR entry.
 * Priority: _resourceType field → MIME type → URL extension
 *
 * @param {Object} entry - HAR entry object
 * @returns {ResourceType}
 */
export function inferResourceType(entry) {
  if (!entry || typeof entry !== 'object') return 'other';

  // Check custom field _resourceType
  if (entry._resourceType) {
    const type = String(entry._resourceType).toLowerCase();
    const known = ['fetch', 'xhr', 'document', 'script', 'stylesheet', 'image', 'font'];
    if (known.includes(type)) return type;
  }

  // Check MIME type
  const mimeType = entry.response?.content?.mimeType;
  if (mimeType && typeof mimeType === 'string') {
    const mime = mimeType.toLowerCase();
    if (mime.includes('javascript')) return 'script';
    if (mime.includes('css')) return 'stylesheet';
    if (mime.includes('image')) return 'image';
    if (mime.includes('font') || mime.includes('woff') || mime.includes('ttf'))
      return 'font';
    if (mime.includes('html')) return 'document';
    if (mime.includes('json') || mime.includes('xml')) return 'fetch';
  }

  // Check URL extension
  const url = entry.request?.url;
  if (url && typeof url === 'string') {
    const urlLower = url.toLowerCase();
    if (urlLower.match(/\.(js|mjs)($|\?)/)) return 'script';
    if (urlLower.match(/\.css($|\?)/)) return 'stylesheet';
    if (urlLower.match(/\.(png|jpg|jpeg|gif|webp|svg)($|\?)/)) return 'image';
    if (urlLower.match(/\.(woff|woff2|ttf|otf|eot)($|\?)/)) return 'font';
    if (urlLower.match(/\.html($|\?)/)) return 'document';
  }

  return 'other';
}

/**
 * Extract initiator hostname from HAR entry.
 * Priority: _initiator.url → Referer header → Origin header (not "null") → null
 *
 * @param {Object} entry - HAR entry object
 * @returns {string|null}
 */
export function detectInitiatorHost(entry) {
  if (!entry || typeof entry !== 'object') return null;

  // 1. _initiator.url (Chrome DevTools extension)
  if (entry._initiator?.url) {
    const initiatorUrl = parseEntryUrl(entry._initiator.url);
    if (initiatorUrl) {
      return initiatorUrl.hostname;
    }
  }

  // 2. Referer header (case-insensitive)
  const headers = entry.request?.headers || [];
  if (Array.isArray(headers)) {
    const refererHeader = headers.find(
      (h) => h.name && h.name.toLowerCase() === 'referer'
    );
    if (refererHeader?.value) {
      const refererUrl = parseEntryUrl(refererHeader.value);
      if (refererUrl) {
        return refererUrl.hostname;
      }
    }

    // 3. Origin header (not "null" string)
    const originHeader = headers.find(
      (h) => h.name && h.name.toLowerCase() === 'origin'
    );
    if (originHeader?.value && originHeader.value !== 'null') {
      const originUrl = parseEntryUrl(originHeader.value);
      if (originUrl) {
        return originUrl.hostname;
      }
    }
  }

  return null;
}

/**
 * Full entry analysis combining all detection functions.
 * @param {Object} entry - HAR entry
 * @param {string[]} allowList
 * @param {string[]} excludeList
 * @returns {{hostname: string|null, pathname: string, urlContext: UrlContext, resourceType: ResourceType, initiatorHost: string|null, initiatorFirstParty: boolean|null}}
 */
export function analyzeEntry(entry, allowList, excludeList) {
  const url = parseEntryUrl(entry?.request?.url);
  const hostname = url?.hostname || null;
  const pathname = url?.pathname || '';
  const urlContext = detectUrlContext(pathname);
  const resourceType = inferResourceType(entry);
  const initiatorHost = detectInitiatorHost(entry);

  // Determine if initiator is first-party
  let initiatorFirstParty = null;
  if (initiatorHost) {
    initiatorFirstParty = isAllowedDomain(
      initiatorHost,
      allowList,
      excludeList
    );
  }

  return {
    hostname,
    pathname,
    urlContext,
    resourceType,
    initiatorHost,
    initiatorFirstParty,
  };
}
