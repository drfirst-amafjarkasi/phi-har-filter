# phi-phi-har-filter

A production-grade Node.js CLI tool for filtering HAR (HTTP Archive) files to DrFirst-owned domains and applying HIPAA-oriented privacy redaction focused on **patient PHI** (not prescriber/provider identifiers).

## ⚠️ Legal Disclaimer

**This tool reduces PHI exposure but does NOT guarantee legal HIPAA compliance.** It applies best-effort privacy redaction patterns. You must validate all outputs before sharing, especially in regulated environments. Consult your legal and compliance teams before using this tool in a regulated context.

## Key Features

- **Domain filtering**: Allowlist DrFirst-owned domains; keep only relevant network entries
- **Streaming architecture**: Process 100MB+ HAR files without buffering entire contents into memory
- **Provider-aware redaction**: NPI, DEA, prescriber identifiers are NOT redacted by default (they are not patient PHI)
- **Patient PHI redaction**: Automatically redacts patient identifiers (MRN, DOB, SSN, patient_id, etc.)
- **Flexible output**: HAR, entries, grouped summaries, decision logs, error reports
- **Multiple output formats**: Pretty table, JSON, YAML, CSV, tree view
- **Gzip compression**: Optional output compression with ratio reporting
- **Colored, real-time progress**: Progress bar with live counts, rate, and ETA
- **Dry-run preview**: `--dry-run-sample N` to inspect redaction before writing files
- **Redirect preservation**: Optionally preserve redirect chains from kept entries
- **Unique naming**: Output files timestamped + content-hashed for reproducibility

## Installation

```bash
npm install --save-dev phi-phi-har-filter
# Or install globally
npm install -g phi-phi-har-filter
```

Then run:

```bash
phi-phi-har-filter --in input.har --out ./output/
```

Or with npx:

```bash
npx phi-phi-har-filter --in input.har --out ./output/
```

## Quick Start

### Basic filtering (default: DrFirst domains + HIPAA redaction)

```bash
phi-phi-har-filter --in traffic.har --out ./out/
```

Creates:
- `out/traffic.filtered.YYYYMMDDHHMMSS.HASH.har.json` (filtered HAR)
- `out/traffic.summary.YYYYMMDDHHMMSS.HASH.json` (summary with colored table output)

Output displays:
- Real-time progress bar with processing rate & ETA
- Colored summary table (entries, redaction counts, timing)
- Tree view of grouped domains

### Keep provider details, redact only patient PHI

```bash
phi-har-filter --in traffic.har --out ./out/ \
  --redact hipaa \
  # NPI, DEA, prescriber names NOT redacted by default ✓
```

### Strict mode: redact everything including provider PII

```bash
phi-har-filter --in traffic.har --out ./out/ \
  --redact strict \
  --redact-provider-pii
```

### Preserve redirect chains

```bash
phi-har-filter --in traffic.har --out ./out/ \
  --keep-redirects \
  --redirect-depth 5
```

### Filter by status codes and output grouped summary with gzip compression

```bash
phi-har-filter --in traffic.har --out ./out/ \
  --status 400+ \
  --extract-errors \
  --group-by domain \
  --mode entries,grouped,summary,decisions \
  --gzip
```

### View sample of redacted entries before writing files

```bash
phi-har-filter --in traffic.har --dry-run-sample 10
# Shows first 10 entries with redaction details, exits without writing files
```

### Output summary in different formats

```bash
# Pretty table (default)
phi-har-filter --in traffic.har --out ./out/ --format table

# YAML format
phi-har-filter --in traffic.har --out ./out/ --format yaml

# CSV for Excel
phi-har-filter --in traffic.har --out ./out/ --format csv

# Tree view
phi-har-filter --in traffic.har --out ./out/ --format tree
```

### First-party only (entries initiated from DrFirst contexts)

```bash
phi-har-filter --in traffic.har --out ./out/ \
  --first-party-only \
  --first-party-strict  # drop if initiator is unknown
```

## Redaction Profiles

### NPI and Provider Identifiers

**NPI (National Provider Identifier) is NOT patient PHI.** It is a public prescriber identifier. By default, `phi-har-filter` does NOT redact:

- NPI
- DEA number
- Prescriber/provider IDs
- Provider names
- License numbers
- Facility/practice names
- Taxonomy codes

**Why?** These are professional identifiers, not personal health information about patients. Over-redacting them destroys useful clinical context and differs from actual HIPAA requirements (which protect *patient* data, not provider credentials).

To redact provider details as well:

```bash
--redact-provider-pii
```

### Redaction Levels

| Level | Behavior |
|-------|----------|
| `none` | No redaction |
| `basic` | Redact auth tokens, secrets, cookies only; keep User-Agent |
| `hipaa` | **Default**. Redact patient identifiers, auth headers, User-Agent, non-JSON bodies; keep provider details |
| `strict` | Redact everything including provider PII; drop all non-JSON bodies |

### Headers Always Redacted (All Levels)

- `Authorization`, `Proxy-Authorization`
- `Cookie`, `Set-Cookie`
- `X-Api-Key`, `Api-Key`, `X-Amz-Security-Token`
- Any header containing `token`, `auth`, `secret`, `session`, `key`, `bearer`, `jwt` (case-insensitive)

### Query Parameters & JSON Fields (Patient Context)

Redacted in patient/member contexts:

- Patient identifiers: `patient_id`, `mrn`, `member_id`, `ssn`, `dob`, `email`, `phone`
- Member data: `subscriber_id`, `beneficiary_id`, `enrollee_id`
- Clinical data: `chart_number`, `rx_number`

### Options

#### I/O

- `--in <path>` **Required.** Input HAR file path
- `--out-dir <dir>` Output directory (default: same directory as input)
- `--name <name>` Base name for outputs (default: input filename)
- `--mode <list>` Comma-separated output modes: `har`, `entries`, `grouped`, `summary`, `decisions`, `errors` (default: `har,summary`)
- `--jsonl` Write entries/grouped as JSON Lines (one object per line)

#### Domain Control

- `--domains <file>` JSON array or newline-delimited text file of allowed domain suffixes
- `--exclude <domain>` Exclude domain (repeatable, e.g., `--exclude analytics.drfirst.com`)
- `--exclude-domains <file>` File with domains to exclude

#### Filtering

- `--status <expr>` Status code filter: `200`, `200-399`, `400+`, `4xx`
- `--methods <list>` Comma-separated allowed HTTP methods: `GET`, `POST`, etc.
- `--resource-types <list>` Comma-separated types: `fetch`, `xhr`, `document`, `script`, `stylesheet`, `image`, `font`
- `--time-after <iso>` Only entries after this ISO datetime
- `--time-before <iso>` Only entries before this ISO datetime
- `--first-party-only` Keep only entries initiated from DrFirst contexts (heuristic)
- `--first-party-strict` Drop entries with unknown initiator (requires `--first-party-only`)
- `--keep-redirects` Include redirect chains for kept entries
- `--redirect-depth <n>` Max redirect chain depth (default: 10)

#### Redaction

- `--redact <level>` `none`, `basic`, `hipaa`, `strict` (default: `hipaa`)
- `--redact-provider-pii` Also redact provider/prescriber identifiers
- `--keep-user-agent` Keep User-Agent header in hipaa mode
- `--keep-bodies` Keep response bodies in hipaa mode (still redact JSON keys)
- `--dry-run-redaction` Compute redaction plan but do not apply it
- `--no-regex-scrub` Disable regex pattern scrubbing (email, phone, SSN, DOB)

#### Output & Reporting

- `--extract-errors` Write 4xx/5xx/0 status entries to separate file
- `--group-by <strategy>` `domain`, `path`, or `domain+path` (default: `domain`)
- `--fail-if-empty` Exit code 2 if no entries kept
- `--max-entries <n>` Stop after processing N entries (safety limit)
- `--max-bytes <n>` Abort if input exceeds N bytes
- `--format <fmt>` Summary format: `json`, `table` (default), `yaml`, `csv`, `tree`
- `--gzip` Compress output files with gzip (also reports compression ratio)
- `--dry-run-sample <n>` Show N sample entries and redaction details, exit without writing files (useful for previewing changes)
- `--progress` Show progress bar with ETA (default on TTY, auto-disabled in pipes)
- `--validate` Validate input HAR shape before processing

## Output & Display Features

### Colored, Real-Time Progress

- Progress bar with live counts and percentage
- Processing rate and ETA estimation
- Colored output with ✓/✗ indicators

### Output Files

Filenames follow the pattern: `{name}.{type}.{YYYYMMDDHHMMSS}.{HASH8}.{ext}`

Example:
```
traffic.filtered.20260409172331.ae160889.har.json
traffic.entries.20260409172331.ae160889.json
traffic.grouped-by-domain.20260409172331.ae160889.json
traffic.summary.20260409172331.ae160889.json
traffic.decisions.20260409172331.ae160889.json
traffic.errors.20260409172331.ae160889.json
```

With `--gzip`, files are compressed:
```
traffic.filtered.20260409172331.ae160889.har.json.gz
traffic.summary.20260409172331.ae160889.json.gz
```

### Summary Output Formats

| Format | Use Case |
|--------|----------|
| `table` (default) | Human-readable, pretty-printed stats |
| `json` | Programmatic parsing |
| `yaml` | Compact, human-readable |
| `csv` | Import into Excel/spreadsheet |
| `tree` | Tree view of grouped domains |

### HAR Output

Valid HAR 1.2 format with filtered entries and pages:

```json
{
  "log": {
    "version": "1.2",
    "creator": {...},
    "pages": [...],
    "entries": [...]
  }
}
```

### Summary Output

Statistics and redaction metadata:

```json
{
  "meta": {
    "inputFile": "traffic.har",
    "timestamp": "2026-04-09T17:23:31.087Z",
    "toolVersion": "1.0.0"
  },
  "counts": {
    "total": 150,
    "kept": 45,
    "dropped": 105,
    "keepRate": 0.30
  },
  "dropReasons": {
    "not-allowlisted": 80,
    "status-filtered": 15,
    "unknown-initiator": 10
  },
  "redaction": {
    "headersCount": 12,
    "queryParamsCount": 8,
    "patientFieldsCount": 3,
    "providerFieldsCount": 0,
    "bodiesCount": 2
  },
  "disclaimer": "This tool applies best-effort privacy redaction. It does not constitute legal HIPAA compliance."
}
```

### Decision Log

Per-entry filtering and redaction details:

```json
[
  {
    "index": 0,
    "url": "https://api.drfirst.com/patient/123",
    "decision": "kept",
    "dropReasons": [],
    "context": {
      "urlContext": "patient",
      "initiatorHost": "portal.drfirst.com"
    },
    "redaction": {
      "redactedHeadersCount": 1,
      "redactedQueryParamsCount": 0
    }
  }
]
```

## Domain Allowlist

Default allowlist (18 DrFirst-owned domains):

```json
[
  "drfirst.com",
  "staging.drfirst.com",
  "nonprod.drfirst.com",
  "kafka.qa.drfirst.com",
  "link.drfirst.com",
  "myndview.drfirst.com",
  "drfirst.ca",
  "epcsdrfirst.com",
  "iprescribe.com",
  "rxinform.org",
  "rxlocal.com",
  "aiderx.info",
  "backline-health.com",
  "diagnotes.com",
  "getmyrx.com",
  "myndview.app",
  "akariobl.com"
]
```

To use a custom domain file:

```json
[
  "drfirst.com",
  "my-custom-domain.com"
]
```

```bash
phi-har-filter --in traffic.har --out ./out/ --domains ./domains.json
```

Or as newline-delimited text with comments:

```
drfirst.com
# Internal domains
my-custom-domain.com
my-other-domain.com
```

## Limitations & Notes

### HAR Exporter Differences

- **Chrome DevTools**: Exports `_initiator` field (most reliable for first-party detection)
- **Firefox**: Limited initiator information; first-party detection less reliable
- **Postman/Insomnia**: May not populate `redirectURL`; falls back to `Location` header

### Initiator Heuristic (First-Party Detection)

First-party detection uses:
1. `entry._initiator.url` (Chrome DevTools)
2. `Referer` request header
3. `Origin` request header (ignores literal `"null"`)
4. Falls back to URL hostname matching if `--first-party-strict` is NOT set

If your HAR doesn't include these fields, first-party detection may be inaccurate.

### Redirect Chain Preservation

- Uses `response.redirectURL` or `Location` header to link entries
- Matches redirects by normalized URL (strips query params)
- Prevents cycles with a visited-set during BFS
- HAR exporters may not capture full redirect chains; this tool can only work with available entries

### Performance

- Streams `log.entries` to avoid loading entire HAR in memory
- Two-pass strategy when `--keep-redirects` is set
- Tested with 100MB+ HAR files
- Memory usage bounded by output entries (filtered set) + metadata

## Testing

```bash
npm test
```

Runs node:test suite covering:
- Domain matching (suffix logic, exclude overrides)
- URL parsing and context detection
- **NPI non-redaction regression** (critical test)
- Patient PHI redaction
- Auth token redaction
- Redirect chain cycles and depth limits
- Output naming and formats

## Examples

### Export sensitive logs but keep provider context

```bash
phi-har-filter --in debug.har --out ./safe/ \
  --redact hipaa \
  --group-by domain
```

Output: Patient identifiers redacted, NPI intact, grouped by domain for easy review.

### Audit: track all dropped entries

```bash
phi-har-filter --in traffic.har --out ./audit/ \
  --mode entries,grouped,summary,decisions \
  --extract-errors
```

Output: `decisions.*.json` shows why each entry was dropped.

### Compare two HAR filters

```bash
phi-har-filter --in v1.har --out ./out/ --name v1
phi-har-filter --in v2.har --out ./out/ --name v2
# Then diff the summary files
diff out/v1.summary.*.json out/v2.summary.*.json
```

## License

MIT

## Contributing

Pull requests welcome. Ensure all tests pass and add tests for new features.

```bash
npm test
```

## Support

For issues, questions, or feedback:
- Review the full spec in the README above
- Check test files for usage examples
- Run with `--validate --progress` for detailed diagnostics
