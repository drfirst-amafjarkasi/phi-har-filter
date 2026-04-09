import { readFileSync } from 'fs';

/**
 * Default DrFirst-owned domain allowlist.
 * These are treated as apex domains; both apex and subdomains match.
 */
export const DEFAULT_DRFIRST_DOMAINS = [
  'drfirst.com',
  'staging.drfirst.com',
  'nonprod.drfirst.com',
  'kafka.qa.drfirst.com',
  'link.drfirst.com',
  'myndview.drfirst.com',
  'drfirst.ca',
  'epcsdrfirst.com',
  'iprescribe.com',
  'rxinform.org',
  'rxlocal.com',
  'aiderx.info',
  'backline-health.com',
  'diagnotes.com',
  'getmyrx.com',
  'myndview.app',
  'akariobl.com',
];

/**
 * Normalize a domain string: lowercase, strip leading/trailing dots.
 * @param {string} domain
 * @returns {string}
 */
export function normalizeDomain(domain) {
  if (typeof domain !== 'string') return '';
  return domain.toLowerCase().replace(/^\.+|\.+$/g, '');
}

/**
 * Check if hostname matches an apex domain.
 * Matches if hostname === apex OR hostname ends with '.' + apex.
 * Both are normalized to lowercase.
 *
 * @param {string} hostname - e.g. 'api.drfirst.com' or '192.168.1.1'
 * @param {string} apexDomain - e.g. 'drfirst.com'
 * @returns {boolean}
 */
export function matchesDomain(hostname, apexDomain) {
  const normalizedHost = normalizeDomain(hostname);
  const normalizedApex = normalizeDomain(apexDomain);

  if (!normalizedHost || !normalizedApex) return false;

  return (
    normalizedHost === normalizedApex ||
    normalizedHost.endsWith('.' + normalizedApex)
  );
}

/**
 * Check if a hostname is allowed.
 * Returns true if hostname matches any domain in allowList
 * AND is not in excludeList. Exclude wins over include.
 *
 * @param {string} hostname
 * @param {string[]} allowList
 * @param {string[]} [excludeList]
 * @returns {boolean}
 */
export function isAllowedDomain(hostname, allowList, excludeList = []) {
  const normalizedHost = normalizeDomain(hostname);

  // Check exclude list first (exclude wins)
  for (const excludeDomain of excludeList) {
    if (matchesDomain(normalizedHost, excludeDomain)) {
      return false;
    }
  }

  // Check allow list
  for (const allowDomain of allowList) {
    if (matchesDomain(normalizedHost, allowDomain)) {
      return true;
    }
  }

  return false;
}

/**
 * Parse a domain list from text content.
 * Supports both JSON array format and newline-delimited text with # comments.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function parseDomainList(content) {
  if (typeof content !== 'string') return [];

  // Try JSON array first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map((d) => normalizeDomain(String(d))).filter((d) => d);
    }
  } catch {
    // Not JSON, fall through to text parsing
  }

  // Parse as newline-delimited text
  return content
    .split('\n')
    .map((line) => {
      // Remove comments and trim
      const commentIdx = line.indexOf('#');
      const cleaned =
        commentIdx >= 0 ? line.substring(0, commentIdx) : line;
      return normalizeDomain(cleaned.trim());
    })
    .filter((d) => d);
}

/**
 * Load and parse a domain file from disk.
 *
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
export async function loadDomainFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    return parseDomainList(content);
  } catch (err) {
    throw new Error(`Failed to load domain file: ${filePath}\n${err.message}`);
  }
}
