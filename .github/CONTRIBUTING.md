# Contributing to har-filter

Thank you for interest in contributing to `har-filter`! This document provides guidelines and instructions for contributions.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Report security issues privately (see below)

## Getting Started

1. **Fork the repository**
   ```bash
   gh repo fork
   ```

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/har-filter.git
   cd har-filter
   git remote add upstream https://github.com/drfirst-amafjarkasi/phi-har-filter.git
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Making Changes

- **Read the code first** — Understand the architecture in the plan file (`C:\Users\ajarkasi\.claude\plans\temporal-honking-hummingbird.md`)
- **Understand streaming design** — HAR entries are streamed; don't buffer unnecessarily
- **Preserve backward compatibility** — Don't break existing CLI options
- **Test your changes** — Add tests to `test/` directory using `node:test`

### Testing

```bash
# Run all tests
npm test

# Run specific test file
node --test test/domains.test.js

# Run with coverage (future)
npm run test:coverage
```

### Code Style

- Use ESM (ES Modules) — `import`/`export`, not `require`
- Use `const` by default, `let` when needed
- Use JSDoc comments for exports
- Follow existing code patterns
- Keep line length reasonable (80-100 chars)

### Committing

Use clear, descriptive commit messages:

```
feat: add --config-file support for pre-defined profiles

- Allow users to specify .har-filterrc JSON config file
- Support environment variable override
- Test config loading and merging

Closes #42
```

Format: `type: description` where type is one of:
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `test:` test additions/changes
- `refactor:` code restructuring (no feature change)
- `perf:` performance improvement
- `chore:` dependencies, tooling

## PR Guidelines

1. **One feature per PR** — Keep changes focused
2. **Describe what & why** — Not just what changed
3. **Reference issues** — Link to related issues
4. **Pass tests** — All 68 tests must pass, no regressions
5. **Update docs** — If changing CLI, update README.md
6. **Add tests** — New features should include tests

### PR Title Format

```
[FEAT] Add config file support
[FIX] Prevent NPI redaction in provider context
[DOCS] Update README with examples
```

## Important Notes

### PHI & Security

- **NPI is NOT patient PHI** — This is a critical invariant. Don't redact NPI by default.
- **Test redaction logic** — Add tests to `test/redact.test.js` for any PHI-related changes
- **No real data** — Never commit test files with actual patient information

### Streaming & Performance

- **Don't buffer entries** — Use streaming pattern from `cli.js` Phase 1
- **Profile large files** — Test with 100MB+ HAR files
- **Memory limits** — Keep peak memory reasonable (target < 500MB for typical usage)

### Testing

All changes must maintain or improve test coverage:

```javascript
// Example test
test('feature works correctly', () => {
  const input = { /* test data */ };
  const result = functionUnderTest(input);
  assert.equal(result.status, 'expected');
});
```

The critical test: **NPI non-redaction regression**
```javascript
test('REGRESSION: NPI is NOT redacted by default', () => {
  // This test MUST pass always
  // See test/redact.test.js for the full regression test
});
```

## Areas for Contribution

### High Priority

- [ ] Config file support (`.har-filterrc`)
- [ ] Resume/checkpoint capability
- [ ] Streaming write mode (don't buffer output entries)
- [ ] Validation/lint mode

### Medium Priority

- [ ] Predefined redaction profiles
- [ ] Differential comparison mode
- [ ] Additional domain context detection
- [ ] Performance benchmarking suite

### Low Priority

- [ ] Web UI dashboard
- [ ] Integration with other HAR tools
- [ ] Plugin system
- [ ] Internationalization

## Reporting Issues

### Bugs

Provide:
- Steps to reproduce
- Expected behavior
- Actual behavior
- HAR file (sanitized if possible)
- Environment (Node version, OS)

### Security Issues

**Do NOT open a public issue.** Email security contact instead with:
- Description of vulnerability
- Steps to reproduce
- Potential impact

### Feature Requests

Include:
- Use case
- Proposed syntax/UI
- Why it's useful
- Any alternatives considered

## Questions?

- **Check README.md** — Comprehensive docs
- **Check tests** — See `test/` for usage examples
- **Open a discussion** — Ask in Issues

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see LICENSE file).

---

**Thank you for contributing to har-filter!** 🎉
