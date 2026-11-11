# 0012. Screening decisions are human; suggestions are separate

**Status:** Accepted
**Date:** 2026-11-11

## Context

Screening is where a review becomes defensible or not. A tool can rank and
suggest, but if it silently decides inclusion, the review has no human
judgement behind it. Automation bias is also real: a confident suggestion
changes what a tired reviewer notices.

At the same time, asking a human to classify every record from scratch is slow
and inconsistent. The tool should reduce the work without taking the decision.

## Decision

Keep two separate stores:

- `ScreeningSuggestion` — the tool's proposal: suggested decision, suggested
  priority, confidence, rationale, method and model. Regenerable, never
  authoritative.
- `Screening` — append-only human decisions: `include` / `exclude` / `maybe`,
  priority `core` / `supporting` / `peripheral`, a controlled reason code, free
  text, tags, reviewer and timestamp.

A human override always wins and is visible. A suggestion is never edited into a
decision; it stays in the record. The CLI provides batch import/export and quick
triage; the local web UI is the intended place for reading abstracts and
exercising judgement. The GUI and CLI share the same core and the same store.

Brief-level exclusions (`exclude_keywords`, `exclude_venues`,
`exclude_domains`, `exclude_types`) flag and count by default. `--drop-excluded`
hides flagged records only after the count is shown. Keyword matching uses word
boundaries, not substrings. A human include overrides a filter flag.

## Consequences

- Every decision is attributable and reversible by appending, not overwriting.
- Suggestions can be regenerated without touching the audit trail.
- The tool can auto-suggest but cannot auto-decide by default; an explicit
  `--auto-exclude` would be a separate, logged policy.
- Two tables and more columns, but a much clearer answer to "who decided this?"
- The GUI is the primary reading surface; the CLI stays honest about being a
  quick triage and batch tool.
