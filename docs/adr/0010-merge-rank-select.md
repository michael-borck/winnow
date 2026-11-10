# 0010. Cross-provider merge, rank and selection

**Status:** Accepted
**Date:** 2026-11-11

## Context

`--limit 40` implied ordering and truncation, but the first pipeline had no
merge or rank stage before the limit. That is where bias enters: ordering by
citation count favours old, famous work, and provider scores are not
comparable. "Weigh", the stage that gives the tool its name, had no algorithm,
schema or entity.

## Decision

Make selection explicit and reproducible:

1. Merge by identifier and keep every provider's rank.
2. Fuse provider relevance lists with reciprocal rank fusion (k = 60).
3. Apply machine filters only (year, type, language, open access).
4. Select top N with deterministic tie-breakers: check completeness, recency,
   citation percentile within year and field when available, open access.
5. Record every candidate in `RunSource` with provider rank, RRF score, final
   rank and `selected`, whether or not it was selected.

Reserve a counter-evidence retrieval budget inside selection, but report the
stance distribution uncapped. Weigh outputs inspectable features — study
design, source type, peer-review status, citation count and date, percentile,
open access, quality flags, stance and coverage — not a composite quality
score.

## Consequences

- Truncation is visible and auditable; `--limit` no longer deletes the record of
  what was found.
- No provider score calibration is required.
- Citation counts inform tie-breaks and display, not the primary relevance
  signal.
- Field percentiles remain null until a reliable provider is confirmed.
- Study-design labels are suggestions until a human confirms them.
