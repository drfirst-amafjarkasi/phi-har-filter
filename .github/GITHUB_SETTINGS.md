# GitHub Repository Configuration

This document outlines the recommended settings for the `har-filter` GitHub repository.

## Repository Name & Slug

**Name:** `har-filter`  
**Full URL:** `https://github.com/YOUR_ORG/har-filter`  
**Description:** Filter HAR files to DrFirst domains with HIPAA-oriented privacy redaction

## About Section

### Short Description (60 chars)
```
Filter HAR files with HIPAA privacy redaction
```

### Long Description (250+ chars)
```
A production-grade Node.js CLI tool for parsing and filtering HAR (HTTP Archive) files 
to DrFirst-owned domains, with context-aware privacy redaction focused on patient PHI. 
Features streaming architecture for large files (100MB+), provider-aware redaction 
(NPI preserved by default), colored progress reporting, multiple output formats, and 
gzip compression support.
```

## Topics/Tags

Add these topics to help discoverability:

```
har
http-archive
privacy
redaction
hipaa
drfirst
cli
node
patient-data
phi
filtering
network-analysis
security
```

## Key Features (for About)

- ✓ HAR file filtering and domain-based allowlisting
- ✓ HIPAA-oriented privacy redaction (patient PHI only)
- ✓ NPI/prescriber identifiers preserved by default
- ✓ Streaming architecture for 100MB+ files
- ✓ Colored terminal output with real-time progress & ETA
- ✓ Multiple output formats (HAR, JSON, JSONL, CSV, YAML, tree)
- ✓ Gzip compression support
- ✓ Dry-run sample preview mode
- ✓ Comprehensive test suite (68 tests)
- ✓ Production-ready with error handling

## Legal Notice

⚠️ **Important:** This tool applies best-effort privacy redaction but does NOT guarantee 
legal HIPAA compliance. See README.md for full disclaimer.

## External Links

Add to repo about/links:
- **Documentation:** See README.md
- **Issues/Feedback:** GitHub Issues
- **License:** MIT (if applicable)

## Visibility & Access

- **Repository Type:** Public (for team access)
- **Branch Protection:** main branch (when ready)
- **Collaborators:** DrFirst engineering team

## Actions/Automation

Recommended CI/CD (if implementing):
```yaml
- Run tests on PR (npm test)
- Verify no regressions on commits
- Build checks on releases
```
