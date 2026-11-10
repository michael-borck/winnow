# 0008. Sentence taxonomy and post-generation checks

**Status:** Accepted
**Date:** 2026-11-11

## Context

The first spec promised that "unsupported sentences are removed". The checker
could only prove that a citation ID existed and a quote occurred in the source.
It could not prove that the quote supported the sentence, so a real quote could
sit under an overstated claim. The rule also deleted gap claims, synthesis and
connective prose, none of which can carry a single quote.

## Decision

Tag every draft sentence as one of four types:

- `evidence` — needs one or more claim IDs, each with a quote;
- `synthesis` — needs two or more claim IDs, and for a comparison at least one
  per side;
- `coverage` — needs a deterministic corpus query, not a quote;
- `framing` — no facts, no numbers, no study names; linted.

Run five deterministic checks (schema, IDs, verbatim quotes at declared spans,
numbers present in quotes or recomputed, synthesis shape), then one support
check as a labelled suggestion from a separate model.

Outcomes are `kept`, `kept_marked`, `held` and `dropped`. Only checks 1–5 can
drop a sentence. A support result of `unsupported` or `contradicted` holds the
sentence for human review; it never deletes it silently.

## Consequences

- "No source, no sentence" becomes "no source, no evidence sentence". Framing
  prose is allowed but cannot smuggle facts.
- The guarantee is provenance, stated honestly. Support is assistive.
- The support checker has no pass threshold in v0.3; its precision and recall
  are measured and published.
- Human edits re-run checks 1–5, and check 6 on request.
- Quote matching requires a normalisation rule and stored `SourceText` versions.
