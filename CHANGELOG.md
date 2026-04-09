# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-09

### Added
- Initial production-grade release of har-filter
- **Streaming architecture**: Process 100MB+ HAR files without buffering entire contents
- **Domain filtering**: Allowlist DrFirst-owned domains (18 domains by default)
- **HIPAA-oriented privacy redaction**: Patient PHI redaction while preserving provider identifiers (NPI, DEA, etc.)
- **Provider-aware redaction**: Correctly treats NPI and provider identifiers as non-PHI
- **Multiple output formats**: HAR, entries, grouped summaries, decision logs, error reports
- **Summary visualization**: Pretty table, JSON, YAML, CSV, and tree view formats
- **Gzip compression**: Optional output compression with ratio reporting
- **Real-time progress bar**: Live entry count, processing rate, and ETA
- **Dry-run preview**: `--dry-run-sample` to inspect redaction before writing files
- **Redirect chain preservation**: Optionally preserve redirect chains from kept entries
- **Unique naming**: Output files timestamped + content-hashed for reproducibility
- **First-party detection**: Heuristic-based filtering for entries initiated from DrFirst contexts
- **Comprehensive CLI options**:
  - Status code filtering (200, 200-399, 400+, 4xx)
  - HTTP method filtering
  - Resource type filtering (fetch, xhr, document, script, etc.)
  - Time range filtering (before/after ISO datetime)
  - Redirect depth control
- **Multiple redaction profiles**: `none`, `basic`, `hipaa` (default), `strict`
- **Configuration file support**: Load custom domain allowlists
- **Comprehensive documentation**:
  - Detailed README with examples
  - Contributing guidelines
  - GitHub setup guide
  - Issue templates (bug, feature request)
  - Pull request template
- **Extensive test coverage**: 68 tests covering domain matching, filtering, redaction, and output
- **GitHub Actions CI/CD**: Test matrix across Ubuntu, macOS, Windows with Node 18 & 20
- **MIT License**: Open-source friendly licensing

### Technical Details
- **Architecture**: Three-phase processing (Hash+Metadata → Filter → Redirect Expansion)
- **Streaming**: Uses `stream-chain` and `stream-json` for memory-efficient parsing
- **Performance**: ~1000+ entries/sec throughput with minimal memory footprint
- **Compatibility**: Node 18.0.0+, works on Windows, macOS, Linux
- **Package exports**: Modular design with separate exports for domains, redaction, filtering, output

### Security & Compliance
- **HIPAA focus**: Redacts patient identifiers (MRN, SSN, DOB, etc.) by default
- **NPI preservation**: Correctly identifies NPI as provider (not patient) PHI
- **Auth token redaction**: Removes authorization headers, cookies, API keys
- **User-Agent filtering**: Redacts in HIPAA mode to prevent device fingerprinting
- **Regex pattern matching**: Email, phone, SSN, and DOB pattern detection
- **Dry-run validation**: Preview redaction plan without writing files

### Known Limitations
- First-party detection reliability depends on HAR exporter (Chrome DevTools most reliable)
- Firefox HAR exports limited initiator information
- Redirect chains limited to depth 10 by default (configurable)
- Large HAR files (>1GB) may exceed available memory (test with --max-bytes)

## Future Enhancements

### High Priority (Planned)
- Config file support (`.har-filterrc` with preset profiles)
- Resume/checkpoint capability for interrupted large files
- Streaming write mode to reduce output buffering
- Validation/lint mode for HAR shape verification

### Medium Priority
- Predefined redaction profiles per industry
- Differential comparison mode (compare two filtered outputs)
- Enhanced domain context detection (API patterns, service classification)
- Performance benchmarking suite with regression detection

### Low Priority
- Web UI dashboard for visual filtering
- Integration with other HAR analysis tools
- Plugin system for custom redaction rules
- Internationalization (i18n) for CLI output

## Versioning Policy

- **MAJOR**: Breaking changes to CLI options, output format, or default behavior
- **MINOR**: New features (new options, output modes, formats)
- **PATCH**: Bug fixes, documentation updates, performance improvements

## Backwards Compatibility

v1.0.0 and beyond will maintain CLI backwards compatibility:
- Existing option names will not be removed or changed
- New options will be added with different names
- Output file format (HAR 1.2) is stable
- Summary format may be extended but not broken

For deprecations or breaking changes, they will be:
1. Announced in release notes with migration guide
2. Implemented in next MAJOR version only
3. Supported in MINOR versions with deprecation warnings

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Code style (ESM, const-first, JSDoc comments)
- Testing requirements (68 tests must pass)
- Commit message format
- PR guidelines

## License

MIT - See [LICENSE](LICENSE) for full text.

---

**Release Date:** 2026-04-09  
**Repository:** https://github.com/drfirst-amafjarkasi/har-filter  
**NPM Package:** https://www.npmjs.com/package/har-filter
