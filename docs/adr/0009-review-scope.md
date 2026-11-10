# 0009. Structured narrative and scoping reviews in v1

**Status:** Accepted
**Date:** 2026-11-11

## Context

The first spec used PRISMA-style counts and promised a "defensible review",
which implies systematic-review rigour. But v1 retrieves a relevance-ranked
top-N, does not store per-database search strings or counts, has no full-text
eligibility stage, and has a single reviewer field. A systematic review needs
exhaustive retrieval and, in practice, dual independent screening.

## Decision

Scope v1 to **structured narrative reviews and scoping reviews**. Report
**PRISMA-inspired flow counts** (identified, deduplicated, screened, excluded by
reason, included) and label them as such in every export. Do not claim PRISMA
compliance or a systematic review.

An exhaustive mode — uncapped retrieval, per-database strings and counts,
full-text eligibility, multi-reviewer screening and conflict resolution — is
deferred and listed in the spec's open questions.

## Consequences

- The tool is honest about what a bounded search can support.
- Reviewers and examiners will not mistake the output for a systematic review.
- Single-reviewer screening is acceptable for the stated scope; the audit trail
  still records every decision.
- The path to systematic review is explicit rather than implied.
