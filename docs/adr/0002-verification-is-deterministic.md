# 0002. Verification is deterministic and model-independent

**Status:** Accepted
**Date:** 2026-11-11
**Superseded in part by:** [0007](0007-orthogonal-verification.md) (the five-state list only; the deterministic principle stands)

## Context

Citation fabrication is the failure mode that destroys trust in AI research
tools. A fluent model can invent a plausible title, author list and DOI. If the
same model is asked whether the reference exists, it may agree with itself.

## Decision

No model participates in verification. Existence is established only by
registry lookups, DOI resolution and URL checks, using `cite-sight-core`.
Verification records five orthogonal axes — identity, match category, integrity
notices, link status and check completeness — as defined in ADR 0007.
Citability is derived from those axes by one deterministic function.

The model may later summarise, screen or label a source. It may never change a
verification state. Unattested unverified records are listed but cannot be cited
in a draft or exported to BibTeX.

## Consequences

- Verification quality depends on registry coverage, not model size. A local 3B
  model and a frontier model produce identical verification results.
- Some legitimate sources with no DOI (books, reports) remain `unverified` and
  are excluded from citation export unless a named reviewer attests them. An
  attested grey-literature record is cited with a visible flag (ADR 0007). This
  is deliberate: a missing citation is recoverable, a fabricated one is not.
- The UI must explain the difference between "found" and "verified", or users
  will assume both mean the same thing.
