# 0004. Counter-evidence via query inversion, citation chasing and stance labelling

**Status:** Accepted
**Date:** 2026-11-11

## Context

A literature review that only finds supporting material is an advocacy
document. Users asked for opposing papers and counterarguments, but "find
material that disagrees" is a stance judgement, not a metadata query, and a
model can hallucinate disagreement as easily as agreement.

## Decision

Counter-evidence is a retrieval problem first and a labelling problem second:

1. **Query inversion.** Generate critical queries from the topic or thesis,
   using a model when available and a term-expansion heuristic otherwise.
2. **Citation chasing.** Retrieve papers that cite the target paper through
   OpenAlex and Semantic Scholar, keeping citation contexts where supplied.
3. **Stance labelling.** Suggest `supports`, `opposes`, `mixed` or `unclear`
   for each abstract, with a required quote. Label it a suggestion and require
   human confirmation.

Counter-results run through the same verification and enrichment as the main
set, are capped at about one third of results, and report coverage honestly
when little counter-evidence is found.

## Consequences

- The tool never claims a paper disagrees without a quote and a human check.
- Counter-evidence quality depends on the inversion queries and on citation
  context availability; both are measured in v0.3.
- A null result ("we found little credible opposition") is a valid and useful
  output, not a failure.
