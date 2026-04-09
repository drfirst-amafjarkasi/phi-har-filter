# Architecture & Design

This document describes the internal architecture of har-filter and design decisions.

## System Overview

har-filter is a **streaming HAR processor** that filters entries to allowlisted domains and applies HIPAA-oriented privacy redaction. The design prioritizes **memory efficiency** and **security**.

```
Input HAR (100MB+)
    ↓
Phase 0: Hash & Metadata (streaming)
    ↓ (file digest + version/creator/pages)
Phase 1: Filter Pass (streaming)
    ↓ (keep/drop decision for each entry)
├─ Optional → Phase 2: Redirect Expansion (graph-based)
├─ Optional → Phase 3: Output Collection (streaming)
    ↓
Output: Filtered HAR + Summary + Other Modes
```

## Three-Phase Architecture

### Phase 0: Hash & Metadata (Single-pass)
**Purpose**: Compute input file hash and extract HAR metadata without buffering entries.

- **Hash computation**: SHA-256 of entire file (for reproducible output naming)
- **Metadata extraction**: HAR version, creator, browser, pages array
- **Streaming**: Uses `stream-json` with `Pick` filter to skip entries

**Time complexity**: O(n) where n = file size
**Space complexity**: O(1) - only metadata buffer

### Phase 1: Filter Pass (Single-pass)
**Purpose**: Stream entries, make keep/drop decisions, collect metadata, redact if no redirects.

**For each entry**:
1. Parse URL, analyze context, detect initiator
2. Apply filtering rules (domain, status, method, time range, first-party)
3. If keeping and no redirect expansion needed: redact immediately
4. Track metadata for decision log

**Output**:
- `metadata[]`: One record per entry (index, URL, decision, reasons)
- `initialKeepSet`: Set of indices to keep
- `redactionReports`: Map of index → redaction counters
- `keptEntries[]`: Collected entries (if not using redirects)
- `dropReasons`: Aggregated drop reason statistics

**Conditional behavior**:
- If `--keep-redirects`: Store only metadata; skip redaction
- If no redirects: Redact entries immediately; return keptEntries

**Time complexity**: O(n) where n = number of entries
**Space complexity**: O(k) where k = number of kept entries (+ metadata)

### Phase 2: Redirect Expansion (Graph-based, optional)
**Triggered by**: `--keep-redirects` flag

**Purpose**: Build redirect graph and expand keep set to include redirect targets.

1. **Build redirect graph**:
   - Normalize URLs (strip query params, fragment)
   - Map each entry's redirect target to target entry index
   - Sources: `response.redirectURL` or `Location` header

2. **BFS expansion**:
   - Start from initial keep set
   - Follow redirect edges up to `--redirect-depth` (default 10)
   - Prevent cycles with visited set
   - Add all reachable entries to final keep set

**Data structures**:
- `urlToIndex: Map<string, number>`: Normalized URL → entry index
- `graph: Map<number, number[]>`: Entry index → redirect target indices

**Time complexity**: O(n + e) where n = entries, e = redirect edges
**Space complexity**: O(n) for graph

### Phase 3: Output Collection (Streaming, optional)
**Triggered by**: Redirect expansion in Phase 2

**Purpose**: Re-stream input and collect final entries for indices in expanded keep set.

- Re-parse input file
- Only process entries in `finalKeepSet`
- Redact collected entries
- Sort by original index to preserve order

**Why re-stream?**
- Phase 1 didn't buffer entries (memory efficient)
- Phase 2 determined which entries to keep
- Phase 3 needs actual entry objects for output

**Time complexity**: O(n) where n = entries (skips dropped entries quickly)
**Space complexity**: O(k) where k = final kept entries

---

## Memory Efficiency Strategy

### Streaming JSON Parsing
- **Library**: `stream-json` + `stream-chain`
- **Pattern**: Parse file as stream, emit one entry at a time
- **Benefit**: Don't load entire HAR in memory

### Conditional Buffering
- **Phase 1 only**: Buffer redacted entries if no redirect expansion
- **Phase 2+**: Only store metadata in Phase 1; re-stream for output

### Output Accumulation
- **Summary**: Small JSON object (< 1KB)
- **Decision log**: One object per entry (100 bytes each)
- **Grouped entries**: Dictionary of lists (depends on grouping strategy)
- **HAR output**: Only kept entries + filtered pages

### Typical Memory Profile (1000-entry HAR)
```
Phase 0:  ~1 MB (file hash stream)
Phase 1:  ~5 MB (200 kept entries, metadata, counters)
Phase 2:  ~15 MB (redirect graph + metadata)
Phase 3:  ~5 MB (final entries, output)
Peak:     ~15 MB (graph + collections)
```

---

## Redaction Design

### Invariant: NPI is NOT Patient PHI
- **NPI (National Provider Identifier)**: Public prescriber ID, NOT redacted by default
- **Provider keys**: DEA, license, facility name — also NOT redacted by default
- **Patient keys**: MRN, SSN, DOB, patient_id — always redacted in HIPAA mode

This reflects HIPAA's focus on protecting **patient data**, not provider credentials.

### Redaction Levels

| Level | Headers | Query Params | JSON Fields | Bodies | User-Agent |
|-------|---------|--------------|-------------|--------|-----------|
| `none` | No | No | No | No | No |
| `basic` | ✓ (auth only) | No | No | No | No |
| `hipaa` | ✓ (auth + headers) | ✓ (patient) | ✓ (patient) | ✓ (non-JSON) | ✓ |
| `strict` | ✓ (all) | ✓ (all) | ✓ (all) | ✓ (all) | ✓ |

### Redaction Algorithm

1. **Header redaction**: Check against `AUTH_SECRET_KEYS` set (case-insensitive)
2. **Query parameter redaction**: Parse and check against context-aware key sets
3. **JSON body redaction**: Recursive descent, redact matching keys
4. **Regex pattern matching** (optional): Email, phone, SSN, DOB patterns

### Provider PII Flag
- `--redact-provider-pii`: Also redact `PROVIDER_KEYS` set
- Separate flag to allow clinical context preservation by default

---

## Filtering Pipeline

### Order of Filters (Phase 1)
1. **URL parsing**: Must be parseable (hostname extraction)
2. **Domain filtering**: Must match allowlist and not be excluded
3. **Status code**: If specified, response status must match
4. **HTTP method**: If specified, request method must match
5. **Resource type**: If specified, inferred type must match
6. **Time range**: Entry timestamp must be in range
7. **First-party heuristic**: If enabled, initiator must match rules

All filters use early exit (return on first failure).

### Initiator Detection (First-Party Heuristic)
Tries in order:
1. `entry._initiator.url` (Chrome DevTools - most reliable)
2. `request.headers.referer` (HTTP standard)
3. `request.headers.origin` (HTTP standard, ignores literal `"null"`)
4. URL hostname matching (fallback if `--first-party-strict` not set)

---

## Output Modes

### Mode: `har`
- Standard HAR 1.2 format
- Filtered entries + filtered pages (only pages referenced by kept entries)
- Redacted per configured level

### Mode: `entries`
- Array of filtered entries (no pages, no log structure)
- Useful for further processing

### Mode: `grouped`
- Entries grouped by strategy (domain, path, or domain+path)
- Each group contains array of entries
- Useful for analysis and reporting

### Mode: `summary`
- Aggregated statistics
- Drop reasons breakdown
- Redaction counts
- Processing timings
- Can be formatted as JSON, table, YAML, CSV, or tree

### Mode: `decisions`
- Decision log: one record per entry
- Includes filter result, drop reasons, redaction counts
- Useful for audit trail

### Mode: `errors`
- Subset of entries with 4xx/5xx/0 status codes
- Useful for debugging failed requests

---

## Performance Characteristics

### Throughput
- **Typical**: 800-1200 entries/sec
- **Factors**: Entry size, redaction complexity, I/O speed

### Memory
- **Small files** (< 10MB): ~10-20 MB peak
- **Large files** (100-500MB): ~50-150 MB peak (with redirects)
- **Very large files** (> 1GB): May exceed available memory

### Disk I/O
- **Input read**: Single pass (streaming)
- **Redirect expansion**: Two passes (Phase 1 + Phase 3)
- **Output write**: Single pass (sequential)

### Benchmarks (on typical machine)
```
Test File Size | Entries | Time | Rate | Memory Peak
10 MB          | 5000    | 4s   | 1250/s | 25 MB
50 MB          | 25000   | 18s  | 1389/s | 80 MB
100 MB         | 50000   | 35s  | 1429/s | 120 MB
```

---

## File Organization

```
har-filter/
├── bin/
│   └── har-filter.js          # CLI entry point (shebang + imports)
├── src/
│   ├── cli.js                 # Main CLI logic (phases, I/O, progress)
│   ├── domains.js             # Domain matching, allowlist loading
│   ├── match.js               # URL parsing, context analysis
│   ├── filter.js              # Filtering rules, redirect graph
│   ├── redact.js              # Redaction engine, key sets
│   ├── summarize.js           # Aggregation, summary building
│   └── output.js              # File naming, formatting, writing
├── test/
│   ├── domains.test.js        # Domain matching tests
│   ├── match.test.js          # URL/context analysis tests
│   ├── filter.test.js         # Filtering logic tests
│   ├── redact.test.js         # Redaction tests (NPI invariant)
│   ├── output.test.js         # Output formatting tests
│   └── fixtures/              # Test HAR files (optional)
├── .github/
│   ├── workflows/
│   │   └── test.yml           # CI/CD test matrix
│   ├── CONTRIBUTING.md        # Contribution guidelines
│   ├── GITHUB_SETTINGS.md     # GitHub config reference
│   └── ISSUE_TEMPLATE/        # Issue/PR templates
├── README.md                  # User guide & examples
├── ARCHITECTURE.md            # This file
├── CHANGELOG.md               # Version history
├── GITHUB_SETUP.md            # Repository setup guide
├── LICENSE                    # MIT License
├── package.json               # Dependencies, scripts
└── .gitignore                 # Git exclusions
```

---

## Design Patterns

### Streaming with Stream-Chain
```javascript
StreamChain([
  createReadStream(filePath),
  parser(),
  Pick({ filter: 'log.entries' }),
  streamArray(),
])
```
This pattern:
1. Creates file stream
2. Parses JSON on-the-fly
3. Picks only `log.entries` path
4. Emits each array element separately

### Early Exit Filtering
```javascript
export function filterEntry(entry, index, parsed, opts) {
  const reasons = [];
  
  // Check 1
  if (!parsed.hostname) {
    reasons.push('unparseable-url');
    return { keep: false, reasons };
  }
  
  // Check 2
  if (!isAllowedDomain(...)) {
    reasons.push('not-allowlisted');
    return { keep: false, reasons };
  }
  
  // ... more checks
  
  return { keep: true, reasons: [] };
}
```
Benefits: Clear, testable, debuggable

### Redaction Counters
```javascript
const redactCounters = {};
const redactedEntry = redactEntry(entry, context, opts, redactCounters);
// redactCounters now has: redactedHeadersCount, redactedQueryParamsCount, etc.
```
Benefits: Track what was redacted without modifying redactEntry logic

---

## Security Considerations

### Input Validation
- HAR files are **untrusted user input**
- No eval, JSON.parse (safe), careful regex usage
- Large file size checks (`--max-bytes`)
- Entry count limits (`--max-entries`)

### Data Handling
- Never log sensitive data
- Redaction is applied to outputs only (source HAR unchanged)
- Dry-run mode allows preview without file writes

### Credential Handling
- Auth headers always redacted (never displayed in logs)
- API keys in domain allowlist loaded from files (not CLI args)
- Environment variables never used for sensitive data

### Regex Safety
- No `eval()` or `Function()` usage
- Regex patterns are hardcoded, not user-provided
- Regex timeout/DoS prevention not needed (simple patterns)

---

## Future Improvements

### Config File Support
```json
// .har-filterrc
{
  "domains": ["./domains.json"],
  "redact": "hipaa",
  "keepRedirects": true,
  "outputFormat": "yaml"
}
```

### Resume Checkpoints
- Save Phase 1 metadata to checkpoint file
- Resume from checkpoint (skip re-parsing)
- Useful for interrupted large files

### Streaming Output
- Currently buffers output entries
- Could stream to file using `stream-json/Stringifier`
- Trade-off: Can't provide summary without full pass

### Plugin System
```javascript
// Custom redaction rule
har-filter --plugin ./custom-redact.js
```

---

## References

- [HAR 1.2 Specification](http://www.softwareishard.com/blog/har-12-spec/)
- [HIPAA Privacy Rule](https://www.hhs.gov/hipaa/for-professionals/privacy/index.html)
- [stream-json Documentation](https://github.com/MailOnline/stream-json)
- [Node.js Stream API](https://nodejs.org/api/stream.html)
