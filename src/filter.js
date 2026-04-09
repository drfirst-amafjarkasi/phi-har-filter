import { isAllowedDomain } from './domains.js';
import { parseEntryUrl } from './match.js';

/**
 * Parse a status filter expression into a predicate function.
 * Supports: '200', '200-399', '400+', '4xx', etc.
 *
 * @param {string} expr
 * @returns {(status: number) => boolean}
 */
export function parseStatusFilter(expr) {
  if (!expr || typeof expr !== 'string') {
    return () => true; // no filter
  }

  const trimmed = expr.trim();

  // Range: '200-399'
  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return (status) => status >= min && status <= max;
  }

  // Plus: '400+'
  const plusMatch = trimmed.match(/^(\d+)\+$/);
  if (plusMatch) {
    const min = parseInt(plusMatch[1], 10);
    return (status) => status >= min;
  }

  // Class: '4xx'
  const classMatch = trimmed.match(/^(\d)xx$/i);
  if (classMatch) {
    const digit = parseInt(classMatch[1], 10);
    const min = digit * 100;
    const max = min + 99;
    return (status) => status >= min && status <= max;
  }

  // Single: '200'
  const single = parseInt(trimmed, 10);
  if (!isNaN(single)) {
    return (status) => status === single;
  }

  return () => true; // invalid expr, pass through
}

/**
 * Make a filtering decision for a single entry.
 * @param {Object} entry - HAR entry
 * @param {number} index - entry index
 * @param {Object} parsed - result from analyzeEntry()
 * @param {Object} opts - FilterOptions
 * @returns {{ keep: boolean, reasons: string[] }}
 */
export function filterEntry(entry, index, parsed, opts) {
  const reasons = [];

  // 1. Domain check (null hostname fails)
  if (!parsed.hostname) {
    reasons.push('unparseable-url');
    return { keep: false, reasons };
  }

  if (!isAllowedDomain(parsed.hostname, opts.allowList, opts.excludeList)) {
    reasons.push('not-allowlisted');
    return { keep: false, reasons };
  }

  // 2. Status filter
  if (opts.statusFilter) {
    const status = entry.response?.status || 0;
    if (!opts.statusFilter(status)) {
      reasons.push('status-filtered');
      return { keep: false, reasons };
    }
  }

  // 3. Method filter
  if (opts.allowedMethods && opts.allowedMethods.size > 0) {
    const method = (entry.request?.method || 'GET').toUpperCase();
    if (!opts.allowedMethods.has(method)) {
      reasons.push('method-filtered');
      return { keep: false, reasons };
    }
  }

  // 4. Resource type filter
  if (opts.allowedResourceTypes && opts.allowedResourceTypes.size > 0) {
    if (!opts.allowedResourceTypes.has(parsed.resourceType)) {
      reasons.push('resource-type-filtered');
      return { keep: false, reasons };
    }
  }

  // 5. Time range filter
  const startTime = entry.startedDateTime;
  if (startTime) {
    try {
      const ts = new Date(startTime).getTime();
      if (opts.timeAfterMs !== null && ts < opts.timeAfterMs) {
        reasons.push('before-time-range');
        return { keep: false, reasons };
      }
      if (opts.timeBeforeMs !== null && ts > opts.timeBeforeMs) {
        reasons.push('after-time-range');
        return { keep: false, reasons };
      }
    } catch {
      // Invalid timestamp, pass through
    }
  }

  // 6. First-party filter
  if (opts.firstPartyOnly) {
    if (parsed.initiatorFirstParty === false) {
      // Known to be third-party
      reasons.push('not-first-party');
      return { keep: false, reasons };
    } else if (parsed.initiatorFirstParty === null) {
      // Unknown initiator
      if (opts.firstPartyStrict) {
        reasons.push('unknown-initiator');
        return { keep: false, reasons };
      }
      // Fall through (keep with unknown initiator if not strict)
    }
  }

  return { keep: true, reasons: [] };
}

/**
 * Normalize URL for redirect matching: remove query params and hash.
 * Returns origin + pathname.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrlForRedirect(url) {
  const parsed = parseEntryUrl(url);
  if (!parsed) return url;
  return parsed.origin + parsed.pathname;
}

/**
 * Build a redirect graph from entry metadata.
 * Returns map of index -> [target indices] and urlToIndex map.
 *
 * @param {Array} metadata - EntryMetadata array
 * @returns {{ graph: Map<number, number[]>, urlToIndex: Map<string, number> }}
 */
export function buildRedirectGraph(metadata) {
  const graph = new Map();
  const urlToIndex = new Map();

  // Build URL index
  for (const m of metadata) {
    const normalizedUrl = normalizeUrlForRedirect(m.url);
    urlToIndex.set(normalizedUrl, m.index);
  }

  // Build graph: if entry has redirectURL or Location header, link to target
  for (const m of metadata) {
    const targets = [];

    // Check response.redirectURL
    if (m.redirectURL && m.redirectURL.trim() !== '') {
      const targetUrl = normalizeUrlForRedirect(m.redirectURL);
      const targetIdx = urlToIndex.get(targetUrl);
      if (targetIdx !== undefined && targetIdx !== m.index) {
        targets.push(targetIdx);
      }
    }

    // Check Location header (if no redirectURL)
    if (!m.redirectURL || m.redirectURL.trim() === '') {
      if (m.location && m.location.trim() !== '') {
        const targetUrl = normalizeUrlForRedirect(m.location);
        const targetIdx = urlToIndex.get(targetUrl);
        if (targetIdx !== undefined && targetIdx !== m.index) {
          targets.push(targetIdx);
        }
      }
    }

    if (targets.length > 0) {
      graph.set(m.index, targets);
    }
  }

  return { graph, urlToIndex };
}

/**
 * Expand initial keep set through redirect graph using BFS.
 * Prevents cycles with visited set.
 *
 * @param {Set<number>} initialKeepSet
 * @param {Map<number, number[]>} graph - adjacency map
 * @param {number} maxDepth - max redirect chain depth
 * @returns {Set<number>}
 */
export function expandKeepSetWithRedirects(initialKeepSet, graph, maxDepth = 10) {
  const finalKeepSet = new Set(initialKeepSet);
  const visited = new Set(initialKeepSet);
  const queue = Array.from(initialKeepSet);

  let depth = 0;

  while (queue.length > 0 && depth < maxDepth) {
    const nextQueue = [];

    for (const idx of queue) {
      const targets = graph.get(idx) || [];
      for (const targetIdx of targets) {
        if (!visited.has(targetIdx)) {
          visited.add(targetIdx);
          finalKeepSet.add(targetIdx);
          nextQueue.push(targetIdx);
        }
      }
    }

    queue.length = 0;
    queue.push(...nextQueue);
    depth++;
  }

  return finalKeepSet;
}
