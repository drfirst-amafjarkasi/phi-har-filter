import { Command } from 'commander';
import { createReadStream, statSync } from 'fs';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import chalk from 'chalk';

const require = createRequire(import.meta.url);
const StreamChain = require('stream-chain');
const { parser } = require('stream-json');
const Pick = require('stream-json/filters/Pick');
const Ignore = require('stream-json/filters/Ignore');
const { streamArray } = require('stream-json/streamers/StreamArray');
const { streamObject } = require('stream-json/streamers/StreamObject');

import { DEFAULT_DRFIRST_DOMAINS, isAllowedDomain, loadDomainFile, parseDomainList } from './domains.js';
import { analyzeEntry } from './match.js';
import { filterEntry, parseStatusFilter, buildRedirectGraph, expandKeepSetWithRedirects } from './filter.js';
import { redactEntry } from './redact.js';
import { groupEntries, buildSummary, buildDecisionLog } from './summarize.js';
import { generateOutputPaths, generateUniqueId, writeAllOutputs, generateTimestamp, formatSummary, formatGroupedAsTree } from './output.js';

const program = new Command();

function fatal(message, code = 1) {
  process.stderr.write(`${chalk.red('✗ Error')}: ${message}\n`);
  process.stderr.write(`${chalk.gray('Run with --help for usage information')}\n`);
  process.exit(code);
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Create a progress bar string
 */
function progressBar(current, total, width = 30) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(width * pct);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format ETA from start time and current progress
 */
function formatETA(startMs, processed, total) {
  if (processed === 0 || total === 0) return '';
  const elapsed = Date.now() - startMs;
  const rate = processed / elapsed;
  const remaining = (total - processed) / rate;
  const seconds = Math.max(0, Math.round(remaining / 1000));

  if (seconds < 60) return `ETA ${seconds}s`;
  if (seconds < 3600) return `ETA ${Math.round(seconds / 60)}m`;
  return `ETA ${Math.round(seconds / 3600)}h`;
}

/**
 * Compute SHA-256 hash of input file.
 */
async function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Extract HAR log metadata (version, creator, browser, pages) without buffering entries.
 */
async function extractHarMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const meta = {};
    const logStream = StreamChain([
      createReadStream(filePath),
      parser(),
      Pick({ filter: 'log' }),
      Ignore({ filter: 'entries' }),
      streamObject(),
    ]);

    logStream.on('data', (data) => {
      const { key, value } = data;
      if (key && value !== undefined) {
        meta[key] = value;
      }
    });

    logStream.on('end', () => {
      resolve({
        version: meta.version || '1.2',
        creator: meta.creator,
        browser: meta.browser,
        pages: meta.pages || [],
      });
    });

    logStream.on('error', (err) => {
      reject(new Error(`Failed to extract HAR metadata: ${err.message}`));
    });
  });
}

/**
 * Phase 1: Stream entries, filter and collect metadata.
 * Returns { metadata, keptEntries (if !keepRedirects), initialKeepSet, redactionReports }
 */
async function filterPass(
  filePath,
  allowList,
  excludeList,
  filterOpts,
  redactOpts,
  progressCallback,
  maxEntries
) {
  const metadata = [];
  const keptEntries = !filterOpts.keepRedirects ? [] : null;
  const initialKeepSet = new Set();
  const redactionReports = new Map();
  const dropReasons = {};

  return new Promise((resolve, reject) => {
    const entryStream = StreamChain([
      createReadStream(filePath),
      parser(),
      Pick({ filter: 'log.entries' }),
      streamArray(),
    ]);

    let index = 0;

    entryStream.on('data', (data) => {
      const entry = data.value;

      if (maxEntries && index >= maxEntries) {
        entryStream.destroy();
        return;
      }

      const parsed = analyzeEntry(entry, allowList, excludeList);
      const decision = filterEntry(entry, index, parsed, filterOpts);

      const redirectURL = entry.response?.redirectURL || '';
      const locationHeader = entry.response?.headers?.find(
        (h) => h.name.toLowerCase() === 'location'
      )?.value || '';

      const meta = {
        index,
        url: entry.request?.url || '',
        redirectURL,
        location: locationHeader,
        status: entry.response?.status || 0,
        pageref: entry.pageref || null,
        keep: decision.keep,
        urlContext: parsed.urlContext,
        initiatorHost: parsed.initiatorHost,
        reasons: decision.reasons,
      };

      metadata.push(meta);

      if (decision.keep) {
        initialKeepSet.add(index);

        if (keptEntries !== null) {
          // Immediate collection mode (no redirect expansion)
          const redactCounters = {};
          const redactedEntry = redactEntry(
            entry,
            parsed.urlContext,
            redactOpts,
            redactCounters
          );
          keptEntries.push(redactedEntry);
          redactionReports.set(index, redactCounters);
        }
      } else {
        // Track drop reasons
        for (const reason of decision.reasons) {
          dropReasons[reason] = (dropReasons[reason] || 0) + 1;
        }
      }

      index++;
      if (progressCallback) {
        progressCallback({
          processed: index,
          kept: initialKeepSet.size,
          dropped: index - initialKeepSet.size,
        });
      }
    });

    entryStream.on('end', () => {
      resolve({
        metadata,
        keptEntries,
        initialKeepSet,
        redactionReports,
        dropReasons,
      });
    });

    entryStream.on('error', (err) => {
      reject(new Error(`Stream error during filter pass: ${err.message}`));
    });
  });
}

/**
 * Phase 3: Output collection pass (when keepRedirects is set).
 * Collects keptEntries for indices in finalKeepSet.
 */
async function outputPass(
  filePath,
  finalKeepSet,
  allowList,
  excludeList,
  redactOpts,
  progressCallback
) {
  const keptEntries = [];
  const redactionReports = new Map();

  return new Promise((resolve, reject) => {
    const entryStream = StreamChain([
      createReadStream(filePath),
      parser(),
      Pick({ filter: 'log.entries' }),
      streamArray(),
    ]);

    let index = 0;

    entryStream.on('data', (data) => {
      const entry = data.value;

      if (finalKeepSet.has(index)) {
        const parsed = analyzeEntry(entry, allowList, excludeList);
        const redactCounters = {};
        const redactedEntry = redactEntry(
          entry,
          parsed.urlContext,
          redactOpts,
          redactCounters
        );
        keptEntries.push({
          index,
          entry: redactedEntry,
        });
        redactionReports.set(index, redactCounters);
      }

      index++;
      if (progressCallback) {
        progressCallback({ processed: index });
      }
    });

    entryStream.on('end', () => {
      // Sort by original index to preserve order
      keptEntries.sort((a, b) => a.index - b.index);
      const entries = keptEntries.map((item) => item.entry);
      resolve({ entries: entries, redactionReports });
    });

    entryStream.on('error', (err) => {
      reject(new Error(`Stream error during output pass: ${err.message}`));
    });
  });
}

/**
 * Main CLI entry point.
 */
async function main() {
  program
    .name('har-filter')
    .description('Filter HAR files to DrFirst domains with HIPAA-oriented privacy redaction')
    .argument('<input>', 'Path to input HAR file')
    .option('--out-dir <dir>', 'Output directory (default: same as input)')
    .option('--name <name>', 'Base name for outputs')
    .option('--mode <modes>', 'Comma-separated modes: har,entries,grouped,summary,decisions', 'har,summary')
    .option('--jsonl', 'Write entries/grouped in JSONL format')
    .option('--domains <file>', 'JSON/text file with allowed domains')
    .option('--exclude <domain>', 'Exclude domain (repeatable)')
    .option('--exclude-domains <file>', 'File with domains to exclude')
    .option('--status <expr>', 'Status filter: 200, 200-399, 400+, 4xx')
    .option('--methods <list>', 'Comma-separated allowed HTTP methods')
    .option('--resource-types <list>', 'Comma-separated resource types')
    .option('--time-after <iso>', 'Only entries after this ISO datetime')
    .option('--time-before <iso>', 'Only entries before this ISO datetime')
    .option('--first-party-only', 'Keep only entries with DrFirst initiator')
    .option('--first-party-strict', 'Drop entries with unknown initiator')
    .option('--keep-redirects', 'Preserve redirect chains')
    .option('--redirect-depth <n>', 'Max redirect chain depth', '10')
    .option('--redact <level>', 'Redaction level: none,basic,hipaa,strict', 'hipaa')
    .option('--redact-provider-pii', 'Also redact provider/prescriber PII (e.g. NPI)')
    .option('--keep-user-agent', 'Keep User-Agent header in hipaa mode')
    .option('--keep-bodies', 'Keep response bodies in hipaa mode')
    .option('--dry-run-redaction', 'Compute redaction but do not apply')
    .option('--dry-run-sample <n>', 'Show N sample entries (dry-run, no output files)')
    .option('--extract-errors', 'Write 4xx/5xx/0 entries to separate file')
    .option('--group-by <by>', 'domain,path,domain+path', 'domain')
    .option('--fail-if-empty', 'Exit code 2 if no entries kept')
    .option('--max-entries <n>', 'Max entries to process')
    .option('--max-bytes <n>', 'Max input file size')
    .option('--format <fmt>', 'Summary format: json,table,yaml,csv,tree', 'table')
    .option('--gzip', 'Compress output files with gzip')
    .option('--progress', 'Show progress (default on TTY)')
    .option('--validate', 'Validate input HAR shape')
    .action(async (inputPath, opts) => {
      try {
        // Validate input file
        let stat;
        try {
          stat = statSync(inputPath);
        } catch (err) {
          fatal(`Input file not found: ${inputPath}`);
        }

        if (!stat.isFile()) {
          fatal(`Input is not a file: ${inputPath}\n       (Is it a directory?)`);
        }

        // Check max-bytes
        const maxBytes = opts.maxBytes ? parseInt(opts.maxBytes, 10) : null;
        if (maxBytes && stat.size > maxBytes) {
          fatal(
            `Input file exceeds max-bytes limit\n` +
            `       File size: ${formatBytes(stat.size)}\n` +
            `       Limit: ${formatBytes(maxBytes)}`
          );
        }

        // Load domain lists
        let allowList = DEFAULT_DRFIRST_DOMAINS;
        if (opts.domains) {
          try {
            allowList = await loadDomainFile(opts.domains);
          } catch (err) {
            fatal(
              `Failed to load domain allowlist: ${opts.domains}\n` +
              `       ${err.message}`
            );
          }
        }

        let excludeList = [];
        if (opts.excludeDomains) {
          try {
            excludeList = await loadDomainFile(opts.excludeDomains);
          } catch (err) {
            fatal(
              `Failed to load domain excludelist: ${opts.excludeDomains}\n` +
              `       ${err.message}`
            );
          }
        }

        // Add --exclude options
        const excludes = Array.isArray(opts.exclude) ? opts.exclude : opts.exclude ? [opts.exclude] : [];
        excludeList = excludeList.concat(excludes);

        // Parse and validate filter options
        const statusFilter = opts.status ? parseStatusFilter(opts.status) : null;

        // Validate methods (basic check for common HTTP methods)
        const validMethods = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']);
        const allowedMethods = opts.methods
          ? new Set(opts.methods.split(',').map((m) => m.trim().toUpperCase()))
          : null;
        if (allowedMethods && allowedMethods.size > 0) {
          const invalidMethods = Array.from(allowedMethods).filter(m => !validMethods.has(m));
          if (invalidMethods.length > 0) {
            process.stderr.write(
              `${chalk.yellow('⚠ Warning')}: Unknown HTTP methods: ${invalidMethods.join(', ')}\n` +
              `       Continuing anyway (may match nothing)\n`
            );
          }
        }

        const validResourceTypes = new Set([
          'fetch', 'xhr', 'document', 'stylesheet', 'script', 'image',
          'font', 'media', 'manifest', 'websocket', 'ping', 'other'
        ]);
        const allowedResourceTypes = opts.resourceTypes
          ? new Set(opts.resourceTypes.split(',').map((t) => t.trim().toLowerCase()))
          : null;
        if (allowedResourceTypes && allowedResourceTypes.size > 0) {
          const invalidTypes = Array.from(allowedResourceTypes).filter(t => !validResourceTypes.has(t));
          if (invalidTypes.length > 0) {
            process.stderr.write(
              `${chalk.yellow('⚠ Warning')}: Unknown resource types: ${invalidTypes.join(', ')}\n` +
              `       Valid: ${Array.from(validResourceTypes).join(', ')}\n`
            );
          }
        }

        let timeAfterMs = null;
        let timeBeforeMs = null;
        if (opts.timeAfter) {
          timeAfterMs = new Date(opts.timeAfter).getTime();
          if (isNaN(timeAfterMs)) {
            fatal(
              `Invalid time-after format: ${opts.timeAfter}\n` +
              `       Expected ISO 8601 (e.g., 2026-04-09T12:00:00Z)\n` +
              `       Examples: 2026-04-09T12:00:00Z, 2026-04-09T12:00:00+00:00`
            );
          }
        }
        if (opts.timeBefore) {
          timeBeforeMs = new Date(opts.timeBefore).getTime();
          if (isNaN(timeBeforeMs)) {
            fatal(
              `Invalid time-before format: ${opts.timeBefore}\n` +
              `       Expected ISO 8601 (e.g., 2026-04-09T12:00:00Z)\n` +
              `       Examples: 2026-04-09T12:00:00Z, 2026-04-09T12:00:00+00:00`
            );
          }
        }

        // Validate time range logic
        if (timeAfterMs !== null && timeBeforeMs !== null && timeAfterMs > timeBeforeMs) {
          fatal(
            `Invalid time range: --time-after is after --time-before\n` +
            `       After: ${opts.timeAfter}\n` +
            `       Before: ${opts.timeBefore}`
          );
        }

        // Validate option combinations
        if (opts.firstPartyStrict && !opts.firstPartyOnly) {
          fatal(
            `Invalid option combination: --first-party-strict requires --first-party-only\n` +
            `       Use: --first-party-only --first-party-strict`
          );
        }

        if (opts.keepUserAgent && opts.redact !== 'hipaa') {
          process.stderr.write(
            `${chalk.yellow('⚠ Warning')}: --keep-user-agent only affects HIPAA mode. Current: --redact ${opts.redact}\n`
          );
        }

        if (opts.keepBodies && opts.redact !== 'hipaa') {
          process.stderr.write(
            `${chalk.yellow('⚠ Warning')}: --keep-bodies only affects HIPAA mode. Current: --redact ${opts.redact}\n`
          );
        }

        const filterOpts = {
          allowList,
          excludeList,
          statusFilter,
          allowedMethods,
          allowedResourceTypes,
          timeAfterMs,
          timeBeforeMs,
          firstPartyOnly: opts.firstPartyOnly || false,
          firstPartyStrict: opts.firstPartyStrict || false,
          keepRedirects: opts.keepRedirects || false,
        };

        // Validate redaction level
        const validRedactLevels = new Set(['none', 'basic', 'hipaa', 'strict']);
        const redactLevel = opts.redact || 'hipaa';
        if (!validRedactLevels.has(redactLevel)) {
          fatal(
            `Invalid redaction level: ${redactLevel}\n` +
            `       Valid levels: none, basic, hipaa (default), strict`
          );
        }

        const redactOpts = {
          redactLevel,
          redactProviderPii: opts.redactProviderPii || false,
          dryRun: opts.dryRunRedaction || false,
          keepUserAgent: opts.keepUserAgent || false,
          keepBodies: opts.keepBodies || false,
        };

        // Progress reporting with ETA
        let lastProgressTime = 0;
        const progressStartTime = Date.now();
        let totalEntriesProcessed = 0;
        const showProgress = opts.progress !== false && process.stderr.isTTY;
        const progressCallback = showProgress
          ? (info) => {
              totalEntriesProcessed = info.processed;
              const now = Date.now();
              if (now - lastProgressTime > 100) {
                // Throttle to 10 FPS
                const kept = info.kept || 0;
                const dropped = info.dropped || 0;
                const total = kept + dropped;
                const pct = total > 0 ? ((kept / total) * 100).toFixed(1) : '0.0';
                const bar = progressBar(kept, Math.max(kept, Math.ceil(total / 10) || 10), 20);
                const eta = total > 10 ? formatETA(progressStartTime, total, total * 2) : '';

                process.stderr.write(
                  `\r${chalk.cyan(bar)} ${kept}/${total} (${pct}%) ${eta}  `.padEnd(85)
                );
                lastProgressTime = now;
              }
            }
          : null;

        const startTime = Date.now();

        // Phase 0: Hash + Metadata
        process.stderr.write(chalk.blue('\n⚙️  Phase 0: Computing hash and extracting metadata...\n'));
        const [fileHash, harMeta] = await Promise.all([
          computeHash(inputPath),
          extractHarMetadata(inputPath),
        ]);

        // Phase 1: Filter pass
        process.stderr.write(chalk.blue('⚙️  Phase 1: Filtering entries...\n'));
        const pass1Start = Date.now();
        const {
          metadata,
          keptEntries: collectedKeptEntries,
          initialKeepSet,
          redactionReports,
          dropReasons,
        } = await filterPass(
          inputPath,
          allowList,
          excludeList,
          filterOpts,
          redactOpts,
          progressCallback,
          opts.maxEntries ? parseInt(opts.maxEntries, 10) : null
        );
        const pass1Ms = Date.now() - pass1Start;

        if (progressCallback) process.stderr.write('\n');

        let finalKeepSet = initialKeepSet;
        let keptEntries = collectedKeptEntries;
        let pass2Ms = 0;
        let pass3Ms = 0;

        // Phase 2: Redirect expansion (if needed)
        if (filterOpts.keepRedirects) {
          process.stderr.write(chalk.blue('⚙️  Phase 2: Expanding redirect chains...\n'));
          const pass2Start = Date.now();
          const { graph } = buildRedirectGraph(metadata);
          finalKeepSet = expandKeepSetWithRedirects(
            initialKeepSet,
            graph,
            parseInt(opts.redirectDepth, 10) || 10
          );
          pass2Ms = Date.now() - pass2Start;

          // Phase 3: Output collection pass
          process.stderr.write(chalk.blue('⚙️  Phase 3: Collecting expanded entries...\n'));
          const pass3Start = Date.now();
          const { entries: expandedEntries, redactionReports: expandedReports } =
            await outputPass(inputPath, finalKeepSet, allowList, excludeList, redactOpts, progressCallback);
          keptEntries = expandedEntries;
          redactionReports.clear();
          expandedReports.forEach((v, k) => redactionReports.set(k, v));
          pass3Ms = Date.now() - pass3Start;

          if (progressCallback) process.stderr.write('\n');
        }

        // Dry-run sample mode
        if (opts.dryRunSample) {
          const sampleSize = parseInt(opts.dryRunSample, 10);
          const samples = keptEntries.slice(0, sampleSize);
          process.stderr.write(chalk.blue(`\n📋 Sample of ${samples.length} kept entries (before/after redaction):\n`));
          samples.forEach((entry, idx) => {
            const original = metadata[idx]?.url || 'unknown';
            process.stderr.write(`\n${chalk.cyan(`Entry ${idx + 1}:`)}\n`);
            process.stderr.write(`  URL: ${original}\n`);
            process.stderr.write(`  Status: ${entry.response?.status || 'N/A'}\n`);
            if (redactionReports.has(idx)) {
              const counts = redactionReports.get(idx);
              process.stderr.write(`  Redaction: ${counts.redactedHeadersCount || 0} headers, ${counts.redactedQueryParamsCount || 0} params, ${counts.redactedJsonFields || 0} JSON fields\n`);
            }
          });
          process.stderr.write(`\n${chalk.yellow('ℹ Dry-run mode: no files written')}\n`);
          process.exit(0);
        }

        // Check --fail-if-empty
        if (opts.failIfEmpty && keptEntries.length === 0) {
          process.stderr.write(chalk.red(`✗ No entries kept. Exiting with code 2.\n`));
          process.exit(2);
        }

        // Assemble output HAR
        const referencedPagerefs = new Set(
          keptEntries.map((e) => e.pageref).filter(Boolean)
        );
        const filteredPages = harMeta.pages.filter((p) => referencedPagerefs.has(p.id));

        const outputHar = {
          log: {
            version: harMeta.version,
            creator: harMeta.creator,
            browser: harMeta.browser,
            pages: filteredPages,
            entries: keptEntries,
          },
        };

        // Aggregate redaction counts
        const aggRedactionCounts = {
          headersCount: 0,
          queryParamsCount: 0,
          patientFieldsCount: 0,
          providerFieldsCount: 0,
          bodiesCount: 0,
        };
        for (const counts of redactionReports.values()) {
          aggRedactionCounts.headersCount += counts.redactedHeadersCount || 0;
          aggRedactionCounts.queryParamsCount += counts.redactedQueryParamsCount || 0;
          aggRedactionCounts.patientFieldsCount += counts.redactedPatientFieldsCount || 0;
          aggRedactionCounts.providerFieldsCount += counts.redactedProviderFieldsCount || 0;
          aggRedactionCounts.bodiesCount += counts.redactedBodiesCount || 0;
        }

        // Build summary and decision log
        const modes = opts.mode
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m);

        const summary = buildSummary({
          inputFile: inputPath,
          totalEntries: metadata.length,
          keptEntries: keptEntries.length,
          dropReasons,
          redactionCounts: aggRedactionCounts,
          timings: { pass1Ms, pass2Ms, pass3Ms, totalMs: Date.now() - startTime },
          outputPaths: {},
        });

        const decisions = buildDecisionLog(metadata, redactionReports);

        // Extract errors if requested
        let errors = [];
        if (opts.extractErrors) {
          errors = keptEntries.filter((e) => {
            const status = e.response?.status || 0;
            return status >= 400 || status === 0;
          });
        }

        // Group entries if requested
        let grouped = {};
        if (modes.includes('grouped')) {
          grouped = groupEntries(keptEntries, opts.groupBy);
        }

        // Generate output paths
        const uniqueId = generateUniqueId(fileHash);
        const outputDir = opts.outDir || require('path').dirname(inputPath);
        const outName = opts.name || require('path').basename(inputPath, require('path').extname(inputPath));
        const outputPaths = generateOutputPaths(inputPath, {
          outDir: outputDir,
          name: outName,
          modes: modes,
          groupBy: opts.groupBy,
          uniqueId,
        });

        // Update summary with output paths
        summary.outputs = outputPaths;

        // Write all outputs
        process.stderr.write(chalk.blue('\n📁 Writing outputs...\n'));
        const { writtenPaths, stats } = await writeAllOutputs({
          outputHar: modes.includes('har') ? outputHar : null,
          keptEntries,
          grouped,
          summary,
          decisions: modes.includes('decisions') ? decisions : [],
          errors,
          outputPaths,
          jsonl: opts.jsonl || false,
          gzip: opts.gzip || false,
          summaryFormat: opts.format || 'table',
        });

        // Print final summary with colors
        const totalTime = Date.now() - startTime;
        const rate = (keptEntries.length / totalTime * 1000).toFixed(2);

        process.stderr.write(chalk.green(`\n✓ Done!\n`));
        process.stderr.write(
          `  ${chalk.cyan('Total entries:')}     ${metadata.length.toLocaleString()}\n`
        );
        process.stderr.write(
          `  ${chalk.cyan('Kept entries:')}      ${chalk.green(keptEntries.length.toLocaleString())}\n`
        );
        process.stderr.write(
          `  ${chalk.cyan('Dropped entries:')}   ${chalk.yellow((metadata.length - keptEntries.length).toLocaleString())}\n`
        );
        process.stderr.write(
          `  ${chalk.cyan('Keep rate:')}         ${chalk.bold(((keptEntries.length / metadata.length) * 100).toFixed(2) + '%')}\n`
        );
        process.stderr.write(
          `  ${chalk.cyan('Processing rate:')}   ${rate} entries/sec\n`
        );
        process.stderr.write(
          `  ${chalk.cyan('Time taken:')}        ${(totalTime / 1000).toFixed(2)}s\n`
        );

        if (opts.gzip && stats.originalBytes > 0) {
          const ratio = ((1 - stats.compressedBytes / stats.originalBytes) * 100).toFixed(1);
          process.stderr.write(
            `  ${chalk.cyan('Compression ratio:')}  ${ratio}% (${formatBytes(stats.originalBytes)} → ${formatBytes(stats.compressedBytes)})\n`
          );
        }

        process.stderr.write(`\n${chalk.blue('📋 Output files:')}\n`);
        writtenPaths.forEach((path) => {
          try {
            const stat = statSync(path);
            const size = formatBytes(stat.size);
            process.stderr.write(`  ${chalk.green('✓')} ${path} (${size})\n`);
          } catch {
            process.stderr.write(`  ${chalk.yellow('✓')} ${path}\n`);
          }
        });

        // Print summary in requested format
        if (modes.includes('summary')) {
          process.stderr.write(`\n${chalk.blue('📊 Summary:')}\n`);
          const summaryFormatted = formatSummary(summary, opts.format || 'table');
          process.stderr.write(summaryFormatted.split('\n').map((l) => '  ' + l).join('\n') + '\n');
        }

        // Print grouped preview if available
        if (modes.includes('grouped') && Object.keys(grouped).length > 0) {
          process.stderr.write(`\n${chalk.blue('🗂️  Grouped entries by ' + opts.groupBy + ':')}\n`);
          const treeFormatted = formatGroupedAsTree(grouped);
          process.stderr.write(treeFormatted.split('\n').map((l) => '  ' + l).join('\n') + '\n');
        }

        process.exit(0);
      } catch (err) {
        fatal(`${err.message}`);
      }
    });

  program.parse(process.argv);
}

main().catch((err) => {
  fatal(err.message);
});
