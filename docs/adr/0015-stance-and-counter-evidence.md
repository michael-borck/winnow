# 0015. Human stance, derived argument map, separate counter-evidence run

**Status:** Accepted
**Date:** 2026-11-11

## Context

"Does this source support my thesis?" is a judgement, not metadata. A tool can
suggest a label from abstract cues, but a confident wrong label can turn a
literature review into advocacy. Counter-evidence has the same problem: if it is
merged silently, the reviewer cannot see what was added or why.

## Decision

- **Stance is human-confirmed.** Suggestions live in `StanceSuggestion` with a
  label, confidence, rationale and quote. Confirmed labels live in `Stance` as
  append-only rows keyed by source and thesis. Changing the thesis changes the
  target hash, so old labels do not silently apply.
- **The argument map is derived.** `winnow argue` builds supporting, opposing,
  mixed and unclear groups from confirmed stance labels and confirmed evidence.
  The strongest node on each side is chosen by relevance, claim count and
  recency. A divided synthesis is emitted only when both sides exist.
- **Argue is conservative.** By default it uses confirmed labels only.
  `--allow-suggested` uses suggestions where a label is missing and the draft
  says so. A disagreement sentence needs two cited sources with differing
  stances; otherwise it is dropped.
- **Counter-evidence is a separate run.** `winnow counter` runs a search with
  critical terms and saves a new run linked to the original. It does not merge
  into the main set. Passing `--thesis` seeds stance suggestions for that run.
  Screening and confirmation remain human.

Citation chasing (Semantic Scholar contexts, OpenAlex cited-by sampling) is
deferred. The current counter-evidence pass is query inversion only.

## Consequences

- A thesis change requires re-labelling, which is honest.
- Counter-evidence is visible, screenable and auditable as its own run.
- The map's strongest-node choice is a heuristic, not a claim about truth; the
  draft shows the evidence behind it.
- The heuristic stance classifier is deliberately simple and explainable. A
  local model can add suggestions later without changing the human store.
- Citation chasing remains a planned retrieval mechanism, not a hidden one.
