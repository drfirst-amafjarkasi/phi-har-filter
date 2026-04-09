import { promises as fs, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { dirname, basename, extname } from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

/**
 * Generate a timestamp string: YYYYMMDDHHMMSS (14 digits).
 * @returns {string}
 */
export function generateTimestamp() {
  const iso = new Date().toISOString();
  const digits = iso.replace(/[^0-9]/g, '');
  return digits.slice(0, 14);
}

/**
 * Generate a unique ID: {timestamp}.{hash8}
 * @param {string} fileHash - SHA-256 hex string
 * @returns {string}
 */
export function generateUniqueId(fileHash) {
  const ts = generateTimestamp();
  const hash8 = (fileHash || '').slice(0, 8).toLowerCase();
  return `${ts}.${hash8}`;
}

/**
 * Generate all output file paths.
 * Pattern: {outDir}/{name}.{type}.{uniqueId}.{ext}
 *
 * @param {string} inputPath
 * @param {Object} opts - { outDir, name, modes: [], groupBy, uniqueId }
 * @returns {Object} - { har, entries, grouped, summary, decisions, errors, ... }
 */
export function generateOutputPaths(inputPath, opts = {}) {
  const {
    outDir = dirname(inputPath),
    name = basename(inputPath, extname(inputPath)),
    modes = [],
    groupBy = 'domain',
    uniqueId = '',
  } = opts;

  const paths = {};

  const modeSet = new Set(modes.map((m) => m.toLowerCase()));

  if (modeSet.has('har')) {
    paths.har = `${outDir}/${name}.filtered.${uniqueId}.har.json`;
  }

  if (modeSet.has('entries')) {
    paths.entries = `${outDir}/${name}.entries.${uniqueId}.json`;
  }

  if (modeSet.has('grouped')) {
    paths.grouped = `${outDir}/${name}.grouped-by-${groupBy}.${uniqueId}.json`;
  }

  if (modeSet.has('summary')) {
    paths.summary = `${outDir}/${name}.summary.${uniqueId}.json`;
  }

  if (modeSet.has('decisions')) {
    paths.decisions = `${outDir}/${name}.decisions.${uniqueId}.json`;
  }

  if (modeSet.has('errors')) {
    paths.errors = `${outDir}/${name}.errors.${uniqueId}.json`;
  }

  return paths;
}

/**
 * Write a filtered HAR object as JSON.
 * @param {Object} outputHar
 * @param {string} filePath
 * @returns {Promise<void>}
 */
export async function writeHarOutput(outputHar, filePath) {
  const json = JSON.stringify(outputHar, null, 2);
  await fs.writeFile(filePath, json, 'utf8');
}

/**
 * Write entries as JSON array or JSONL.
 * @param {Array} entries
 * @param {string} filePath
 * @param {boolean} jsonl
 * @returns {Promise<void>}
 */
export async function writeEntriesOutput(entries, filePath, jsonl = false) {
  let content;
  if (jsonl) {
    content = entries.map((e) => JSON.stringify(e)).join('\n');
  } else {
    content = JSON.stringify(entries, null, 2);
  }
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Write grouped output as JSON or JSONL.
 * Each group includes count and entries array.
 *
 * @param {Object} grouped - { groupKey: { count, entries, ... } }
 * @param {string} filePath
 * @param {boolean} jsonl
 * @returns {Promise<void>}
 */
export async function writeGroupedOutput(grouped, filePath, jsonl = false) {
  let content;
  if (jsonl) {
    const lines = [];
    for (const [key, group] of Object.entries(grouped)) {
      lines.push(JSON.stringify({ [key]: group }));
    }
    content = lines.join('\n');
  } else {
    content = JSON.stringify(grouped, null, 2);
  }
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Write summary stats as JSON.
 * @param {Object} summary
 * @param {string} filePath
 * @returns {Promise<void>}
 */
export async function writeSummaryOutput(summary, filePath) {
  const content = JSON.stringify(summary, null, 2);
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Write decision log as JSON array.
 * @param {Array} decisions
 * @param {string} filePath
 * @returns {Promise<void>}
 */
export async function writeDecisionLog(decisions, filePath) {
  const content = JSON.stringify(decisions, null, 2);
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Write error entries (4xx/5xx/0) as JSON or JSONL.
 * @param {Array} errors
 * @param {string} filePath
 * @param {boolean} jsonl
 * @returns {Promise<void>}
 */
export async function writeErrorsOutput(errors, filePath, jsonl = false) {
  let content;
  if (jsonl) {
    content = errors.map((e) => JSON.stringify(e)).join('\n');
  } else {
    content = JSON.stringify(errors, null, 2);
  }
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Format summary data in multiple formats.
 * @param {Object} summary
 * @param {string} format - 'json', 'table', 'csv', 'yaml'
 * @returns {string}
 */
export function formatSummary(summary, format = 'json') {
  if (format === 'table') {
    const rate = (summary.counts.keepRate * 100).toFixed(2);
    return `
┌─────────────────────────┬─────────────────┐
│ Metric                  │ Value           │
├─────────────────────────┼─────────────────┤
│ Total Entries           │ ${String(summary.counts.total).padEnd(15)} │
│ Kept Entries            │ ${String(summary.counts.kept).padEnd(15)} │
│ Dropped Entries         │ ${String(summary.counts.dropped).padEnd(15)} │
│ Keep Rate               │ ${String(rate + '%').padEnd(15)} │
├─────────────────────────┼─────────────────┤
│ Headers Redacted        │ ${String(summary.redaction.headersCount || 0).padEnd(15)} │
│ Query Params Redacted   │ ${String(summary.redaction.queryParamsCount || 0).padEnd(15)} │
│ Patient Fields Redacted │ ${String(summary.redaction.patientFieldsCount || 0).padEnd(15)} │
│ Bodies Redacted         │ ${String(summary.redaction.bodiesCount || 0).padEnd(15)} │
├─────────────────────────┼─────────────────┤
│ Processing Time         │ ${String(summary.timing.totalMs + 'ms').padEnd(15)} │
└─────────────────────────┴─────────────────┘
`.trim();
  }

  if (format === 'yaml') {
    const rate = (summary.counts.keepRate * 100).toFixed(2);
    return `counts:
  total: ${summary.counts.total}
  kept: ${summary.counts.kept}
  dropped: ${summary.counts.dropped}
  keepRate: ${rate}%

redaction:
  headers: ${summary.redaction.headersCount || 0}
  queryParams: ${summary.redaction.queryParamsCount || 0}
  patientFields: ${summary.redaction.patientFieldsCount || 0}
  bodies: ${summary.redaction.bodiesCount || 0}

timing:
  totalMs: ${summary.timing.totalMs}ms

dropReasons:
${Object.entries(summary.dropReasons || {})
  .map(([reason, count]) => `  ${reason}: ${count}`)
  .join('\n')}
`.trim();
  }

  if (format === 'csv') {
    const rate = (summary.counts.keepRate * 100).toFixed(2);
    return `metric,value
total_entries,${summary.counts.total}
kept_entries,${summary.counts.kept}
dropped_entries,${summary.counts.dropped}
keep_rate,${rate}%
headers_redacted,${summary.redaction.headersCount || 0}
query_params_redacted,${summary.redaction.queryParamsCount || 0}
patient_fields_redacted,${summary.redaction.patientFieldsCount || 0}
bodies_redacted,${summary.redaction.bodiesCount || 0}
processing_time_ms,${summary.timing.totalMs}`;
  }

  // Default: JSON
  return JSON.stringify(summary, null, 2);
}

/**
 * Format grouped entries as tree view.
 * @param {Object} grouped
 * @returns {string}
 */
export function formatGroupedAsTree(grouped) {
  let output = 'Entries Grouped by Domain\n';
  const domains = Object.keys(grouped).sort();

  domains.forEach((domain, idx) => {
    const group = grouped[domain];
    const isLast = idx === domains.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const continuation = isLast ? '    ' : '│   ';

    output += `${prefix}${domain} (${group.count} entries)\n`;

    // Show status codes for this domain
    if (group.statusCodes && group.statusCodes.length > 0) {
      const statusStr = group.statusCodes.join(', ');
      output += `${continuation}Status codes: ${statusStr}\n`;
    }

    // Show avg time
    if (group.avgTime > 0) {
      output += `${continuation}Avg time: ${group.avgTime.toFixed(2)}ms\n`;
    }

    // Show total bytes
    if (group.totalBytes > 0) {
      const mb = (group.totalBytes / 1024 / 1024).toFixed(2);
      output += `${continuation}Total: ${mb}MB\n`;
    }
  });

  return output;
}

/**
 * Write data to file with optional gzip compression.
 * @param {string} content
 * @param {string} filePath
 * @param {boolean} gzip
 * @returns {Promise<void>}
 */
export async function writeFile(content, filePath, gzip = false) {
  const path = gzip ? filePath + '.gz' : filePath;

  if (gzip) {
    const gz = createGzip();
    const writeStream = createWriteStream(path);
    await pipeline(
      Readable.from([content]),
      gz,
      writeStream
    );
  } else {
    await fs.writeFile(path, content, 'utf8');
  }
}

/**
 * Master write function: write all outputs based on modes.
 * Creates outDir recursively before writing.
 *
 * @param {Object} opts
 * @returns {Promise<Object>} - { writtenPaths: [...], stats: {...} }
 */
export async function writeAllOutputs(opts = {}) {
  const {
    outputHar = null,
    keptEntries = [],
    grouped = {},
    summary = {},
    decisions = [],
    errors = [],
    outputPaths = {},
    jsonl = false,
    gzip = false,
    summaryFormat = 'json',
  } = opts;

  // Ensure output directory exists
  if (outputPaths.har || outputPaths.entries || outputPaths.grouped) {
    const outDir = dirname(outputPaths.har || outputPaths.entries || outputPaths.grouped);
    await fs.mkdir(outDir, { recursive: true });
  }

  const writtenPaths = [];
  const stats = {
    originalBytes: 0,
    compressedBytes: 0,
  };

  // Write HAR
  if (outputPaths.har && outputHar) {
    const content = JSON.stringify(outputHar, null, 2);
    await writeFile(content, outputPaths.har, gzip);
    writtenPaths.push(outputPaths.har + (gzip ? '.gz' : ''));
    stats.originalBytes += content.length;
  }

  // Write entries
  if (outputPaths.entries) {
    let content;
    if (jsonl) {
      content = keptEntries.map((e) => JSON.stringify(e)).join('\n');
    } else {
      content = JSON.stringify(keptEntries, null, 2);
    }
    await writeFile(content, outputPaths.entries, gzip);
    writtenPaths.push(outputPaths.entries + (gzip ? '.gz' : ''));
    stats.originalBytes += content.length;
  }

  // Write grouped
  if (outputPaths.grouped && Object.keys(grouped).length > 0) {
    let content;
    if (jsonl) {
      const lines = [];
      for (const [key, group] of Object.entries(grouped)) {
        lines.push(JSON.stringify({ [key]: group }));
      }
      content = lines.join('\n');
    } else {
      content = JSON.stringify(grouped, null, 2);
    }
    await writeFile(content, outputPaths.grouped, gzip);
    writtenPaths.push(outputPaths.grouped + (gzip ? '.gz' : ''));
    stats.originalBytes += content.length;
  }

  // Write summary (with format support)
  if (outputPaths.summary) {
    const content = formatSummary(summary, summaryFormat);
    await writeFile(content, outputPaths.summary, gzip && summaryFormat === 'json');
    writtenPaths.push(outputPaths.summary + (gzip && summaryFormat === 'json' ? '.gz' : ''));
    stats.originalBytes += content.length;
  }

  // Write decisions
  if (outputPaths.decisions) {
    const content = JSON.stringify(decisions, null, 2);
    await writeFile(content, outputPaths.decisions, gzip);
    writtenPaths.push(outputPaths.decisions + (gzip ? '.gz' : ''));
    stats.originalBytes += content.length;
  }

  // Write errors
  if (outputPaths.errors && errors.length > 0) {
    let content;
    if (jsonl) {
      content = errors.map((e) => JSON.stringify(e)).join('\n');
    } else {
      content = JSON.stringify(errors, null, 2);
    }
    await writeFile(content, outputPaths.errors, gzip);
    writtenPaths.push(outputPaths.errors + (gzip ? '.gz' : ''));
    stats.originalBytes += content.length;
  }

  return { writtenPaths, stats };
}
