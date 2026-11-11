# 0013. Extraction starts from confirmed includes; suggestions stay separate

**Status:** Accepted
**Date:** 2026-11-11

## Context

Extraction turns included sources into the evidence table that drafting depends
on. If a tool can quietly pre-fill that table, an unsupported value can travel
into a review without anyone noticing. If it cannot assist at all, the human
retypes the same fields for every paper.

## Decision

Extract only sources whose current screening decision is `include`. Keep two
stores:

- `ExtractionSuggestion` — field, value, quote, location, confidence, method
  and model. Regenerable; never part of the evidence table.
- `Extraction` — append-only human confirmations with field, value, quote,
  location, reviewer and timestamp. The latest row per source and field is the
  confirmed value.

The first extractor is heuristic and explainable: sentence cues for finding and
limitation, regexes for sample and population, and a sentence for method. A
local model can add suggestions later without changing the confirmation store.

CSV and JSON exports keep confirmed values and suggestions in separate columns.
Import reads only confirmed values, so re-importing an exported template cannot
turn a suggestion into a confirmation.

## Consequences

- The evidence table is always human-backed. Every row is attributable.
- Suggestions remain useful without being authoritative.
- Interactive confirmation is slow by design; batch import and a later GUI make
  it tolerable.
- A confirmed value can change, but the history stays.
- Extraction scope is exactly the included set; a later decision change requires
  re-running extraction.
