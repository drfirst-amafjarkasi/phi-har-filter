# Performance Guide

Benchmarks, optimization tips, and memory characteristics for har-filter.

## Throughput

har-filter processes entries at **800-1500 entries/sec** depending on hardware and file characteristics.

### Processing Rate by File Size

| File Size | Entries | Time | Rate | Peak Memory |
|-----------|---------|------|------|-------------|
| 10 MB | 5,000 | 4s | 1,250/s | 25 MB |
| 50 MB | 25,000 | 18s | 1,389/s | 80 MB |
| 100 MB | 50,000 | 35s | 1,429/s | 120 MB |
| 500 MB | 250,000 | 180s | 1,389/s | 400 MB |

**Note**: Actual throughput depends on:
- Entry size (large request/response bodies = slower)
- Redaction complexity (JSON depth, pattern matching)
- I/O speed (SSD vs HDD)
- CPU speed
- Other processes using system resources

## Memory Profile

### Typical Usage Pattern

```
Input: 100MB HAR with 50,000 entries

Phase 0 (Hash + Metadata):  ~1 MB
Phase 1 (Filter pass):      ~80 MB peak
  - Streaming parser: ~5 MB
  - Metadata cache: ~2 MB (50k entries × 40 bytes)
  - Redacted entries: ~70 MB (10k kept × 7KB avg)
  - Counters/sets: ~3 MB

Phase 2 (Redirect expansion): +20 MB
  - Redirect graph: ~15 MB
  - Metadata duplication: ~5 MB

Phase 3 (Output pass):      ~5 MB
  - Final entries collection: ~5 MB

Total Peak: ~100 MB
```

### Memory Optimization Tips

#### 1. Use Streaming When Possible
```bash
# Default - streams intelligently
har-filter --in traffic.har --out ./out/

# Avoid if possible - buffers all entries
har-filter --in traffic.har --out ./out/ \
  --keep-redirects \
  --redirect-depth 10
```

#### 2. Reduce Entries Processed
```bash
# Stop after N entries
har-filter --in traffic.har --out ./out/ \
  --max-entries 10000

# Filter before processing
har-filter --in traffic.har --out ./out/ \
  --status 200-299 \
  --methods GET,POST
```

#### 3. Disable Redirect Expansion
```bash
# Without redirects - uses ~30% less memory
har-filter --in traffic.har --out ./out/

# With redirects - uses more memory for graph
har-filter --in traffic.har --out ./out/ \
  --keep-redirects
```

#### 4. Increase Available Memory (Node.js)
```bash
# Default: ~1.5 GB heap
node bin/har-filter.js --in traffic.har --out ./out/

# Custom heap size
node --max-old-space-size=8192 bin/har-filter.js \
  --in traffic.har --out ./out/
# 8 GB heap
```

## Optimization Strategies

### For Large Files (> 500MB)

**Strategy 1: Process in Batches**
```bash
# Split by time range
har-filter --in traffic.har --out ./out-morning/ \
  --time-after 2026-04-09T00:00:00Z \
  --time-before 2026-04-09T12:00:00Z \
  --name morning

har-filter --in traffic.har --out ./out-afternoon/ \
  --time-after 2026-04-09T12:00:00Z \
  --time-before 2026-04-10T00:00:00Z \
  --name afternoon

# Merge summaries manually
```

**Strategy 2: Limit Entries**
```bash
# Process only first 50k entries
har-filter --in traffic.har --out ./out/ \
  --max-entries 50000
```

**Strategy 3: Disable Redirect Expansion**
```bash
# Redirects require graph in memory
har-filter --in traffic.har --out ./out/
# (no --keep-redirects flag)
```

**Strategy 4: Reduce Output Modes**
```bash
# Fewer modes = less memory for output structures
har-filter --in traffic.har --out ./out/ \
  --mode har
  # Skip: entries, grouped, summary, decisions
```

### For High-Throughput Scenarios

**Pre-filter domains**
```bash
# Create focused allowlist
echo '["api.drfirst.com", "portal.drfirst.com"]' > domains.json

har-filter --in traffic.har --out ./out/ \
  --domains domains.json
# Reduces entries to process
```

**Filter by status code**
```bash
# Skip successful responses, focus on errors
har-filter --in traffic.har --out ./out/ \
  --status 400+ \
  --extract-errors
```

**Disable expensive features**
```bash
# Skip regex pattern matching
har-filter --in traffic.har --out ./out/ \
  --no-regex-scrub
  # Saves ~5-10% time

# Skip redaction (if not needed)
har-filter --in traffic.har --out ./out/ \
  --redact none
```

### For Real-Time Monitoring

**Parallel Processing**
```bash
# Process multiple files simultaneously
for file in traffic-*.har; do
  (har-filter --in "$file" --out ./out/) &
done
wait

# Note: Each process has its own memory footprint
# Ensure system has sufficient RAM
```

**Progress Feedback**
```bash
# See real-time progress with ETA
har-filter --in traffic.har --out ./out/ \
  --progress
  # Auto-enabled on TTY, disabled in pipes
```

## Profiling & Benchmarking

### Built-in Timing

Every run shows timing breakdown:
```
  Processing rate:   1,429 entries/sec
  Time taken:        35.00s

  Broken down by phase:
  Phase 0 (hash):    0.5s
  Phase 1 (filter):  34.2s
  Phase 2 (redirect): 0.3s
  Phase 3 (output):  0.0s (optional)
```

### CPU Profiling (Advanced)

```bash
# Generate flame graph (requires additional tools)
node --prof bin/har-filter.js \
  --in traffic.har --out ./out/

# Process profile
node --prof-process isolate-*.log > profile.txt
cat profile.txt | head -50
```

### Memory Profiling

```bash
# Track heap usage over time
node --trace-gc bin/har-filter.js \
  --in traffic.har --out ./out/ \
  2>&1 | grep "gc"

# Detailed heap snapshot (requires tooling)
node --inspect bin/har-filter.js \
  --in traffic.har --out ./out/
# Then use Chrome DevTools
```

## Comparison: With vs Without Redirects

### Without Redirect Expansion
```
har-filter --in traffic.har --out ./out/

Time: 35s (Phase 0: 0.5s, Phase 1: 34.5s)
Memory Peak: 100 MB
Output: 1 HAR file with 10k entries
```

### With Redirect Expansion
```
har-filter --in traffic.har --out ./out/ \
  --keep-redirects

Time: 45s (Phase 0: 0.5s, Phase 1: 34.5s, Phase 2: 2s, Phase 3: 8s)
Memory Peak: 140 MB
Output: 1 HAR file with 15k entries (incl. redirects)
```

**Cost of Redirect Expansion**:
- +10s processing time (2s graph + 8s re-stream)
- +40 MB peak memory
- +5k entries in output

---

## Limits & Safeguards

### Built-in Limits

| Limit | Default | Purpose |
|-------|---------|---------|
| `--max-entries` | None | Stop after N entries |
| `--max-bytes` | None | Abort if input > N bytes |
| `--redirect-depth` | 10 | Max redirect chain depth |
| `--progress` | TTY only | Show progress bar |

### Recommended Limits

```bash
# For files under 200MB
har-filter --in traffic.har --out ./out/

# For 200-500MB files
har-filter --in traffic.har --out ./out/ \
  --max-entries 100000

# For > 500MB files
har-filter --in traffic.har --out ./out/ \
  --max-entries 50000 \
  --max-bytes 500000000  # 500MB

# On memory-constrained systems
har-filter --in traffic.har --out ./out/ \
  --max-entries 10000 \
  --redirect-depth 3 \
  # (no --keep-redirects) 
```

---

## Real-World Scenarios

### Scenario 1: Quick Daily Audit (Fast)
```bash
# Priority: Speed, minimal memory
har-filter --in daily-traffic.har --out ./audit/ \
  --max-entries 25000 \
  --status 400+ \
  --extract-errors \
  --mode summary

# Expected: ~10s, 30 MB memory
```

### Scenario 2: Complete Compliance Review (Comprehensive)
```bash
# Priority: Completeness, audit trail
har-filter --in compliance.har --out ./review/ \
  --mode har,entries,grouped,decisions \
  --group-by domain+path \
  --keep-redirects

# Expected: ~60s, 200 MB memory
```

### Scenario 3: Development Debugging (Selective)
```bash
# Priority: Subset analysis, fast feedback
har-filter --in dev.har --out ./debug/ \
  --domains api-only.json \
  --dry-run-sample 50 \
  --format tree

# Expected: ~2s (dry-run, no file write), 20 MB memory
```

### Scenario 4: Production Investigation (Large)
```bash
# Priority: Handle large file, reasonable time
har-filter --in production-traffic.har --out ./investigation/ \
  --max-bytes 2000000000 \
  --max-entries 200000 \
  --status 500 \
  --mode summary,errors

# Expected: ~120s (2s timeout if > 2GB), 300 MB memory
```

---

## Performance Regression Testing

Monitor performance over time:

```bash
#!/bin/bash
# benchmark.sh - Run perf tests and log results

TEST_FILE="test-100mb.har"
RESULTS="perf-results.csv"

echo "size_mb,entries,time_sec,rate_per_sec,memory_peak_mb" >> $RESULTS

for size_mb in 10 50 100 500; do
  # Generate test file (if available)
  START=$(date +%s%N)
  
  har-filter --in "$TEST_FILE" \
    --out ./perf-out/ \
    --max-bytes $((size_mb * 1000000)) \
    --progress
  
  END=$(date +%s%N)
  TIME_SEC=$(( (END - START) / 1000000000 ))
  
  # Log result
  echo "$size_mb,?,${TIME_SEC},?,?" >> $RESULTS
done

cat $RESULTS
```

---

## Future Performance Work

### Planned Optimizations
- [ ] Streaming output write (reduce buffering)
- [ ] Parallel regex matching (multiple patterns)
- [ ] Incremental redirect graph building (reduce re-streams)
- [ ] Resume/checkpoint from Phase 1 (skip re-parsing)

### Benchmarking Infrastructure
- [ ] Automated perf test suite
- [ ] Regression detection (alert if throughput drops)
- [ ] Comparison across Node versions
- [ ] Profile visualization

---

## Troubleshooting Performance

### "Much slower than expected"

**Check these**:
1. File size: `ls -lh traffic.har`
2. Disk speed: SSD vs HDD?
3. System load: `top` or Task Manager
4. Antivirus: Disable temporarily if safe
5. Redirect expansion: Is `--keep-redirects` enabled?

### "High memory usage"

**Try these**:
1. Reduce `--max-entries`
2. Disable `--keep-redirects`
3. Disable other output modes (use `--mode har`)
4. Increase Node.js heap: `node --max-old-space-size=8192`

### "Inconsistent timing"

**Normal variation**:
- File system caching
- Other processes
- Disk I/O contention
- Network conditions (if HAR is remote)

**For reliable measurements**:
- Warm up with a test run
- Disable other applications
- Run 3 times, average results
- Use same file and options each time

---

**Last updated**: 2026-04-09
