# 0020. Citation chasing through Semantic Scholar contexts

**Status:** Accepted
**Date:** 2026-11-11

## Context

Critical-term search finds papers that use critical vocabulary. It does not find
the papers that specifically respond to a target work. Citation chasing does:
papers that cite a source are often the ones that extend, qualify or attack it.
OpenAlex exposes cited-by lists without contexts; Semantic Scholar exposes both
citers and the sentence contexts where the citation appears.

## Decision

`winnow counter --of <doi>` fetches the citing papers and contexts from
Semantic Scholar's graph API.

- Store the raw response as a retrieval payload.
- Keep citation contexts with the source.
- Sample deterministically: critical-context count first, then context count,
  recency and citation count. This is a retrieval sample, not a claim that the
  citing paper is hostile.
- Verify every sampled record through the normal DOI path and rank it with the
  normal pipeline.
- Save the result as a separate counter run, never merged into the main set.
- Allow an optional Semantic Scholar API key from
  `SEMANTIC_SCHOLAR_API_KEY`; keyless access is rate-limited.

## Consequences

- Counter-evidence has a second retrieval path that is specific to the target
  work.
- Contexts make a citer's stance inspectable before a full read.
- Semantic Scholar availability and rate limits become part of the run report.
- The sampler can miss a critic with no critical words in the context; human
  screening remains the check.
- Query inversion stays as the path when there is no target DOI.
