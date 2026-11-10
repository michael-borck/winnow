# 0005. The thesis or question is an optional brief, not a required interview

**Status:** Accepted
**Date:** 2026-11-11

## Context

A good review starts with a sharp question. An interactive interview could
sharpen it, but it is awkward in a CLI, slow for batch use, and hostile to
scripting. It also assumes the user does not yet know what they want.

## Decision

The hypothesis is an optional brief file:

```yaml
---
question: Does RAG reduce citation fabrication in literature reviews?
thesis: RAG reduces fabrication when retrieval is verified.
scope:
  date_range: 2018..2026
  disciplines: [computer science]
include: [peer-reviewed studies, preprints with code]
exclude: [opinion pieces]
counter: true
---
Free-text context.
```

`winnow review --brief brief.md` or `winnow review --thesis "..."` runs argument
mode. Without either, the tool runs Explore or Review in landscape mode.
Interactive questioning is deferred to the web UI and evaluated after real CLI
use.

## Consequences

- The CLI stays scriptable and batch-friendly.
- Argument mode is explicit and reproducible; the brief is stored with the run.
- Users who want help forming a question wait for the web UI. That is an
  acceptable v1 gap.
