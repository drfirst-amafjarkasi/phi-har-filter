# Troubleshooting Guide

Common issues and solutions for har-filter.

## Installation Issues

### "har-filter: command not found" after npm install

**Problem**: Installed with `npm install --save-dev` but trying to run globally.

**Solutions**:
```bash
# Option 1: Use npx
npx har-filter --in traffic.har --out ./out/

# Option 2: Install globally
npm install -g har-filter
har-filter --in traffic.har --out ./out/

# Option 3: Use from node_modules
./node_modules/.bin/har-filter --in traffic.har --out ./out/

# Option 4: Add npm script in package.json
{
  "scripts": {
    "filter": "har-filter"
  }
}
# Then run: npm run filter -- --in traffic.har --out ./out/
```

### Permission denied on bin/har-filter.js

**Problem**: File doesn't have execute permission.

**Solution**:
```bash
chmod +x bin/har-filter.js
```

---

## Input File Issues

### "Input file not found" or "Is it a directory?"

**Problem**: Invalid path provided.

**Solutions**:
```bash
# Check file exists
ls -la traffic.har

# Use absolute path
har-filter --in /full/path/to/traffic.har --out ./out/

# Use relative path from current directory
har-filter --in ./traffic.har --out ./out/
```

### "Input file exceeds max-bytes limit"

**Problem**: File is too large (exceeds `--max-bytes`).

**Solutions**:
```bash
# Increase limit (be cautious with memory)
har-filter --in traffic.har --out ./out/ --max-bytes 1000000000  # 1GB

# Or split the file manually and process separately
# HAR files can sometimes be split by pages or time range

# Check actual file size
ls -lh traffic.har

# Process with max-entries safety limit
har-filter --in traffic.har --out ./out/ --max-entries 10000
```

### "Failed to load domain allowlist" or "Failed to load domain excludelist"

**Problem**: Domain file is malformed or unreadable.

**Solutions**:
```bash
# Check file exists and is readable
cat domains.json

# Validate JSON syntax
node -e "console.log(JSON.parse(require('fs').readFileSync('domains.json', 'utf8')))"

# Use newline-delimited format if JSON has issues
# One domain per line, comments with #
echo "drfirst.com
# My custom domain
myapp.com" > domains.txt
har-filter --in traffic.har --domains domains.txt

# Use default domains (no --domains flag)
har-filter --in traffic.har --out ./out/
```

### "Invalid time-after format" or "Invalid time-before format"

**Problem**: Datetime is not ISO 8601 format.

**Solutions**:
```bash
# Correct format (ISO 8601 with Z suffix)
har-filter --in traffic.har --out ./out/ \
  --time-after 2026-04-09T12:00:00Z

# With timezone offset
har-filter --in traffic.har --out ./out/ \
  --time-after 2026-04-09T12:00:00-05:00

# Time range validation - after must be before before
har-filter --in traffic.har --out ./out/ \
  --time-after 2026-04-01T00:00:00Z \
  --time-before 2026-04-30T23:59:59Z
```

---

## Filtering Issues

### "No entries kept" or "No matching entries"

**Problem**: All entries were filtered out.

**Possible causes**:
1. Domain allowlist doesn't match your HAR domains
2. Status code filter too restrictive
3. First-party detection too strict
4. Time range filter doesn't overlap

**Solutions**:
```bash
# Check without domain filtering (use all domains)
# Temporarily create a wildcard allowlist
echo '""' > allow-all.json  # Accepts any domain
har-filter --in traffic.har --domains allow-all.json --dry-run-sample 5

# Preview with dry-run to see what's being filtered
har-filter --in traffic.har --dry-run-sample 10

# Check domains in HAR
# Extract unique domains: you'll need to parse manually
# Or use --keep-redirects to see redirect patterns

# Relax filters one at a time
har-filter --in traffic.har --out ./out/ \
  --dry-run-sample 10 \
  # (no status, method, resource-type filters)

# Check time range
har-filter --in traffic.har --out ./out/ \
  --dry-run-sample 10 \
  --time-after 2000-01-01T00:00:00Z  # Very old
```

### "First-party detection not working"

**Problem**: Entries are being dropped with "not-first-party" or "unknown-initiator"

**Root causes**:
- HAR exporter doesn't include `_initiator` field (Chrome-specific)
- Firefox HAR exports have limited initiator info
- Referer header is missing

**Solutions**:
```bash
# Disable first-party filter
har-filter --in traffic.har --out ./out/ \
  --dry-run-sample 10
  # (no --first-party-only flag)

# Or use loose mode (fallback to URL matching)
har-filter --in traffic.har --out ./out/ \
  --first-party-only \
  # (don't use --first-party-strict)

# Export HAR from Chrome DevTools (most reliable)
# vs Firefox Developer Tools (limited initiator)

# Check HAR structure
# Look for entry._initiator field - if missing, first-party detection won't work
```

### Fewer entries kept than expected

**Problem**: Legitimate entries are being dropped.

**Debugging**:
```bash
# Use dry-run to see decisions
har-filter --in traffic.har --dry-run-sample 20

# Check decision log for reasons
har-filter --in traffic.har --out ./out/ \
  --mode decisions \
  # Review the decisions.*.json file

# Common drop reasons:
# - not-allowlisted: domain not in allowlist
# - status-filtered: status code doesn't match
# - not-first-party: initiator not detected as DrFirst
# - unknown-initiator: initiator can't be determined (and --first-party-strict used)
# - before-time-range / after-time-range: timestamp outside range
```

---

## Redaction Issues

### "NPI is being redacted (unexpectedly)"

**Problem**: NPI numbers are being redacted when they shouldn't be.

**Solution**: Check redaction level.
```bash
# NPI should NOT be redacted by default (hipaa mode)
har-filter --in traffic.har --out ./out/ \
  --redact hipaa  # Default - NPI NOT redacted

# Only redacted if you explicitly request:
har-filter --in traffic.har --out ./out/ \
  --redact hipaa --redact-provider-pii  # Now NPI is redacted
```

### "Patient data is not being redacted"

**Problem**: SSN, DOB, MRN still visible in output.

**Possible causes**:
1. Using `--redact none` or `--redact basic`
2. Patient fields use non-standard names (not in PATIENT_KEYS set)
3. JSON fields are nested or have different casing

**Solutions**:
```bash
# Use HIPAA mode (default)
har-filter --in traffic.har --out ./out/ \
  --redact hipaa  # Patient fields redacted

# Use strict mode if you want everything redacted
har-filter --in traffic.har --out ./out/ \
  --redact strict

# Check what was redacted
har-filter --in traffic.har --out ./out/ \
  --mode decisions \
  # Review redaction counts in decisions.*.json

# For custom field names, you may need to:
# - Use regex pattern matching: values like SSN format
# - Check against the PATIENT_KEYS list in src/redact.js
# - Redact manually or file a feature request
```

### "Headers are not being redacted"

**Problem**: Authorization or API keys still visible.

**Root cause**: Using `--redact none` or `--redact basic`.

**Solutions**:
```bash
# Use HIPAA mode (default)
har-filter --in traffic.har --out ./out/ \
  --redact hipaa

# Or strict mode
har-filter --in traffic.har --out ./out/ \
  --redact strict

# Basic mode only redacts auth-specific keys
har-filter --in traffic.har --out ./out/ \
  --redact basic
  # Redacts: Authorization, Cookie, X-Api-Key, etc.
```

### "User-Agent is visible but I expected it redacted"

**Problem**: User-Agent header not redacted.

**Solution**: Only redacted in HIPAA/strict modes, and can be kept with flag.
```bash
# HIPAA mode (default) - User-Agent is redacted
har-filter --in traffic.har --out ./out/ \
  --redact hipaa
  # User-Agent is redacted

# Keep it with flag
har-filter --in traffic.har --out ./out/ \
  --redact hipaa \
  --keep-user-agent
  # User-Agent is kept

# Basic mode doesn't redact User-Agent at all
```

---

## Output Issues

### "Output files have strange names"

**Problem**: Files like `traffic.filtered.20260409172331.ae160889.har.json` instead of simple names.

**Explanation**: File naming includes timestamp + hash for:
- Reproducibility (same input → same hash)
- Uniqueness (running multiple times creates different files)
- Debugging (know when files were created)

**To understand the format**:
```
{name}.{type}.{YYYYMMDDHHMMSS}.{HASH8}.{ext}

traffic.filtered.20260409172331.ae160889.har.json
       ^^^^^^^^         ^^^^^^^^^^^^^^  ^^^^^^^^
       type             timestamp       hash (8 chars)
```

**If you want custom output names**: (Not currently supported)
- File a feature request for `--output-name` option
- Workaround: `mv` the file after generation

### "No output files were created"

**Problem**: No files in output directory.

**Likely causes**:
1. No entries were kept (all filtered out)
2. Using `--fail-if-empty` and nothing was kept
3. Output directory doesn't exist
4. Permissions issue on output directory

**Solutions**:
```bash
# Check if entries are being kept
har-filter --in traffic.har --dry-run-sample 10

# Create output directory if needed
mkdir -p ./output

# Check directory is writable
touch ./output/test.txt && rm ./output/test.txt

# Without --fail-if-empty, should create files even if empty
har-filter --in traffic.har --out ./output/

# Check what was written
ls -la ./output/
```

### "File is smaller than expected / compression ratio unexpected"

**Problem**: Output HAR is much smaller/larger than expected.

**Possible explanations**:
1. Many entries were filtered out (smaller)
2. Response bodies are large (size before/after redaction)
3. JSON formatting adds whitespace (size increases)
4. Gzip compression (file size decrease)

**To debug**:
```bash
# Check how many entries were kept
har-filter --in traffic.har --out ./out/ \
  --format table
  # Look at "Kept entries" count

# Compare file sizes
ls -lh traffic.har
ls -lh ./out/traffic.filtered.*.har.json

# Check if bodies were redacted/removed
har-filter --in traffic.har --out ./out/ \
  --redact hipaa
  # (bodies non-JSON removed)

  # vs
har-filter --in traffic.har --out ./out/ \
  --redact hipaa --keep-bodies
  # (bodies kept but JSON redacted)
```

### "Invalid HAR output" or "HAR won't open in DevTools"

**Problem**: Output HAR file is malformed.

**Debugging**:
```bash
# Validate HAR structure
node -e "console.log(JSON.parse(require('fs').readFileSync('./out/traffic.filtered.*.har.json', 'utf8')).log)"

# Check for required fields
# HAR must have: log.version, log.creator, log.entries (array)

# If entries are empty, that's valid:
{
  "log": {
    "version": "1.2",
    "creator": { "name": "har-filter", ... },
    "pages": [],
    "entries": []
  }
}
```

---

## Performance Issues

### "Slow processing" or "Hangs"

**Problem**: Tool takes very long or seems hung.

**Possible causes**:
1. Very large file (> 500MB)
2. Redirect expansion creating large graph
3. I/O bound (slow disk)
4. Memory swapping (out of memory)

**Solutions**:
```bash
# Check file size
ls -lh traffic.har

# Use max-entries limit
har-filter --in traffic.har --out ./out/ \
  --max-entries 1000  # Stop after 1000 entries

# Use max-bytes limit
har-filter --in traffic.har --out ./out/ \
  --max-bytes 100000000  # 100MB max

# Disable redirect expansion (if not needed)
har-filter --in traffic.har --out ./out/
  # (no --keep-redirects flag)

# Check progress
har-filter --in traffic.har --out ./out/ \
  --progress
  # (shows live progress bar with ETA)

# Monitor system resources
# On macOS: Activity Monitor
# On Linux: top, htop
# On Windows: Task Manager
```

### "Out of memory" or "JavaScript heap out of memory"

**Problem**: Process crashes with memory error.

**Solutions**:
```bash
# Use smaller redirect depth
har-filter --in traffic.har --out ./out/ \
  --keep-redirects \
  --redirect-depth 3  # Reduce from default 10

# Or don't use redirect expansion
har-filter --in traffic.har --out ./out/
  # (no --keep-redirects)

# Process only N entries
har-filter --in traffic.har --out ./out/ \
  --max-entries 5000

# Increase Node.js heap (advanced)
node --max-old-space-size=4096 ./node_modules/.bin/har-filter \
  --in traffic.har --out ./out/
  # 4GB heap
```

---

## Domain Allowlist Issues

### "Only DrFirst domains in output, but I need my domains"

**Problem**: Using default allowlist (18 DrFirst domains).

**Solution**: Create custom allowlist.
```bash
# JSON format
[
  "drfirst.com",
  "myapp.com",
  "api.myapp.com"
]

# Or newline-delimited
drfirst.com
myapp.com
api.myapp.com

# Use it
har-filter --in traffic.har --out ./out/ \
  --domains ./my-domains.json
```

### "Need to exclude specific domains"

**Problem**: Want to filter to DrFirst domains but exclude one.

**Solution**: Use --exclude flags.
```bash
# Exclude single domain
har-filter --in traffic.har --out ./out/ \
  --exclude analytics.drfirst.com

# Exclude multiple
har-filter --in traffic.har --out ./out/ \
  --exclude analytics.drfirst.com \
  --exclude staging.drfirst.com

# Or use excludelist file
echo "analytics.drfirst.com
staging.drfirst.com" > excludes.txt

har-filter --in traffic.har --out ./out/ \
  --exclude-domains excludes.txt
```

---

## GitHub / Contribution Issues

### "How do I set up to contribute?"

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for full guide.

```bash
# Quick start
gh repo fork
git clone https://github.com/YOUR_USERNAME/har-filter.git
cd har-filter
npm install
npm test
git checkout -b feature/my-feature
# Make changes...
npm test  # Ensure tests pass
git push -u origin feature/my-feature
# Create PR via GitHub
```

### "Tests are failing"

**Solution**: Check Node version and dependencies.
```bash
# Verify Node version (18+)
node --version

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Run tests
npm test

# If specific test fails, run just that one
node --test test/redact.test.js
```

---

## Still Stuck?

1. **Check the README**: [README.md](README.md) - comprehensive guide with examples
2. **Check ARCHITECTURE**: [ARCHITECTURE.md](ARCHITECTURE.md) - design details
3. **Review test files**: `test/*.test.js` - actual usage examples
4. **Open an issue**: [GitHub Issues](https://github.com/drfirst-amafjarkasi/phi-har-filter/issues)
   - Include error message
   - Minimal reproducible example
   - Environment (Node version, OS)
   - Sanitized HAR file if possible

---

**Last updated**: 2026-04-09
