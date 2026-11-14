# 0018. Citeproc renders citations; source IDs remain the contract

**Status:** Accepted
**Date:** 2026-11-11

## Context

The first draft renderer used a hand-built author-year string. It worked for one
source and one style, but it could not handle chapters, reports, theses,
conferences or Vancouver numbering, and it would drift from any reference
manager. Citation formatting is a solved problem with a standard engine.

## Decision

Use citation-js, which wraps citeproc-js, for in-text citations and the reference
list. Support `apa` (default), `vancouver` and `harvard` via `--style`.

- Map source metadata to CSL-JSON: article, chapter, book, report, thesis,
  conference paper and preprint.
- Format each sentence's citation cluster with the chosen style and render the
  reference list in one pass.
- Keep source IDs as the internal contract. The renderer maps IDs to styled
  citations; checks and evidence still use IDs.
- On a rendering failure, fall back to visible source IDs and report the
  failure.

Custom CSL files and a style picker are follow-ups.

## Consequences

- Drafts look like real reviews instead of annotated templates.
- Formatting changes do not change provenance or checks.
- Citation-js adds a dependency and a small startup cost; it is not in the
  correctness path.
- Custom journal styles need a CSL file; named styles cover the common cases for
  now.
- Citation chasing and the review queue remain separate follow-ups.
