# 0002. Verification is deterministic and model-independent

**Status:** Accepted
**Date:** 2026-11-11

## Context

Citation fabrication is the failure mode that destroys trust in AI research
tools. A fluent model can invent a plausible title, author list and DOI. If the
same model is asked whether the reference exists, it may agree with itself.

## Decision

No model participates in verification. Existence is established only by
registry lookups, DOI resolution and URL checks, using `cite-sight-core`.
Verification produces one of `verified`, `likely_valid`, `unverified`,
`retracted` or `dead`, with a confidence score and evidence.

The model may later summarise, screen or label a source. It may never change a
verification state. Unverified records are listed but cannot be cited in a
draft or exported to BibTeX.

## Consequences

- Verification quality depends on registry coverage, not model size. A local 3B
  model and a frontier model produce identical verification results.
- Some legitimate sources with no DOI (books, reports) remain `unverified` and
  are excluded from citation export. This is deliberate: a missing citation is
  recoverable, a fabricated one is not.
- The UI must explain the difference between "found" and "verified", or users
  will assume both mean the same thing.
