---
name: Feature Request
about: Suggest an idea for improvement
title: "[FEATURE] "
labels: enhancement
assignees: ''

---

## Description

Clear description of the feature request. What problem does it solve?

## Motivation

Why is this feature important? What use case does it enable?

## Proposed Solution

How should this feature work? Include example CLI usage if applicable:

```bash
har-filter --in file.har --out ./out/ --new-option value
```

## Alternative Approaches

Are there other ways this could be implemented?

## Additional Context

- Related issues: (link to related issues)
- Screenshots or mockups: (if applicable)
- Impact on existing features: (will this break anything?)

## Acceptance Criteria

How will we know this feature is complete?

- [ ] Feature implemented
- [ ] Tests added
- [ ] Documentation updated
- [ ] No regressions

---

**Note:** Please ensure this feature doesn't conflict with the core design principles:
- Streaming architecture (never buffer entire entry arrays)
- NPI/prescriber identifiers NOT redacted by default
- Focus on patient PHI redaction
