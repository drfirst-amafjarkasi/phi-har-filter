import { parseEntryUrl } from './match.js';

/**
 * Extract group key from entry based on groupBy strategy.
 * @param {Object} entry - HAR entry
 * @param {string} groupBy - 'domain'|'path'|'domain+path'
 * @returns {string}
 */
export function getGroupKey(entry, groupBy = 'domain') {
  const url = parseEntryUrl(entry?.request?.url);

  if (!url) {
    return '(unparseable)';
  }

  const hostname = url.hostname;
  const pathname = url.pathname;

  if (groupBy === 'domain') {
    return hostname || '(no-hostname)';
  }

  if (groupBy === 'path') {
    return pathname || '/';
  }

  if (groupBy === 'domain+path') {
    return `${hostname || '(no-hostname)'}|${pathname || '/'}`;
  }

  return '(unknown)';
}

/**
 * Group entries by the specified strategy.
 * Each group includes: count, entries array, status codes, total bytes, average time.
 *
 * @param {Array} entries - HAR entries
 * @param {string} groupBy
 * @returns {Object} - { groupKey: { count, entries, statusCodes, avgTime, totalBytes } }
 */
export function groupEntries(entries, groupBy = 'domain') {
  const groups = {};

  for (const entry of entries) {
    const key = getGroupKey(entry, groupBy);

    if (!groups[key]) {
      groups[key] = {
        count: 0,
        entries: [],
        statusCodes: new Set(),
        totalBytes: 0,
        totalTime: 0,
        avgTime: 0,
      };
    }

    groups[key].count++;
    groups[key].entries.push(entry);

    // Track status codes
    if (entry.response?.status) {
      groups[key].statusCodes.add(entry.response.status);
    }

    // Track bytes
    if (entry.response?.content?.size) {
      groups[key].totalBytes += entry.response.content.size;
    }

    // Track timing
    if (entry.time) {
      groups[key].totalTime += entry.time;
    }
  }

  // Post-process: sort entries, convert status codes to array, calculate avg time
  const result = {};
  for (const [key, group] of Object.entries(groups)) {
    result[key] = {
      count: group.count,
      entries: group.entries,
      statusCodes: Array.from(group.statusCodes).sort((a, b) => a - b),
      totalBytes: group.totalBytes,
      avgTime: group.count > 0 ? group.totalTime / group.count : 0,
    };
  }

  // Sort by key
  return Object.keys(result)
    .sort()
    .reduce((acc, key) => {
      acc[key] = result[key];
      return acc;
    }, {});
}

/**
 * Build a summary stats object.
 * @param {Object} opts
 * @returns {Object}
 */
export function buildSummary(opts = {}) {
  const {
    inputFile = '',
    totalEntries = 0,
    keptEntries = 0,
    dropReasons = {},
    redactionCounts = {},
    timings = {},
    outputPaths = {},
  } = opts;

  const droppedEntries = totalEntries - keptEntries;
  const keepRate = totalEntries > 0 ? keptEntries / totalEntries : 0;

  return {
    meta: {
      inputFile,
      timestamp: new Date().toISOString(),
      toolVersion: '1.0.0',
    },
    counts: {
      total: totalEntries,
      kept: keptEntries,
      dropped: droppedEntries,
      keepRate: parseFloat(keepRate.toFixed(4)),
    },
    dropReasons: dropReasons || {},
    redaction: redactionCounts || {},
    timing: timings || {},
    outputs: outputPaths || {},
    disclaimer:
      'This tool applies best-effort privacy redaction. It does not constitute legal HIPAA compliance.',
  };
}

/**
 * Build a decision log from metadata and redaction reports.
 * One entry per HAR entry (kept or dropped).
 *
 * @param {Array} metadata - EntryMetadata array
 * @param {Map} redactionReports - Map<index, redactionCounts>
 * @returns {Array}
 */
export function buildDecisionLog(metadata, redactionReports = new Map()) {
  return metadata.map((m) => {
    const redactionCounts = redactionReports.get(m.index) || {};
    return {
      index: m.index,
      url: m.url,
      decision: m.keep ? 'kept' : 'dropped',
      dropReasons: m.reasons || [],
      context: {
        urlContext: m.urlContext,
        initiatorHost: m.initiatorHost,
      },
      redaction: redactionCounts,
    };
  });
}
