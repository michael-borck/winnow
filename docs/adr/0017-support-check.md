# 0017. Support check holds sentences; it never deletes them

**Status:** Accepted
**Date:** 2026-11-11

## Context

Checks 1–5 prove provenance: the source exists, the quote is verbatim, and the
numbers appear in the quote. They cannot prove that the quote supports the
sentence. A real quote can sit under an overstated claim. The first spec
promised to remove unsupported sentences, which the checker could not enforce.

## Decision

Add `--support` as a separate model pass, not a writer feature and not a gate.

- Send only the sentence and its quotes. Do not send the corpus.
- Return `supported`, `partial`, `unsupported` or `contradicted` with a
  confidence and a one-sentence rationale.
- Keep `supported` as kept; mark `partial` as `kept_marked`; move `unsupported`
  and `contradicted` to `held`, which is excluded from the rendered sections and
  listed for review.
- A failed or malformed support call leaves the sentence in place and records
  that the check did not run. An optional check must not silently destroy work.
- Store the support result in the structured draft. The support model may differ
  from the writer model.

## Consequences

- The guarantee is now precise: provenance is enforced; support is assistive.
- Overstated sentences become visible instead of fluent.
- Support model quality matters, and the report does not pretend otherwise.
- Held sentences are reversible by a human, but the current CLI does not yet
  restore them; that belongs with the review queue in the web UI.
- Check 6 remains a suggestion, not a threshold. Citeproc and citation chasing
  are still separate follow-ups.
