# 0019. Held sentences are a queue; restores create a draft revision

**Status:** Accepted
**Date:** 2026-11-11

## Context

The support pass can hold a sentence. A held sentence is not a decision: a human
may judge that the sentence is relevant despite weak entailment, or accept the
hold. Deleting it would hide work; editing the stored draft in place would
destroy the audit trail.

## Decision

- Store the evidence bundle snapshot and a `parent_id` with every draft. The
  snapshot makes re-rendering and review stable even if extraction changes
  later.
- `winnow queue` lists held sentences with the support label and rationale.
- `--restore` creates a **new draft revision**: the sentence becomes
  `kept_marked`, the override records the reviewer, rationale and timestamp, and
  the new draft points at its parent. The rendered draft marks it
  `[restored by <reviewer>]`.
- `--drop` creates a new revision too, records a dropped override, and leaves
  the sentence in the held appendix as `dropped by reviewer`.
- Never mutate a draft in place. Every override is a new row.

## Consequences

- The audit trail survives: original, override and rendered result are all
  stored.
- Draft storage grows with each revision; this is acceptable for the corpus
  sizes Winnow targets.
- Older drafts without a bundle snapshot cannot be queued; re-run review.
- The CLI queue is intentionally small. A full review queue with side-by-side
  evidence belongs in the web UI.
- Citation chasing and custom CSL files remain follow-ups.
