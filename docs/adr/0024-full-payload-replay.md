# 0024. Full payload replay with stored verification

**Status:** Accepted
**Date:** 2026-11-11

## Context

The first replay checked payload hashes and rebuilt the snapshot from stored
sources and verifications. That detected file corruption but not a change in the
provider normaliser or the ranking code: the stored records were already the
output being compared.

## Decision

Replay from the stored provider payloads:

- Export the pure normalisers for OpenAlex, Crossref and Semantic Scholar.
- Re-parse each stored payload, map it to candidates, and re-dedupe.
- Reuse the stored verification records, because re-running DOI resolution would
  require the network and is not a replay.
- Re-rank and re-select using the run's stored limit.
- Rebuild the deterministic snapshot and compare its hash with the stored hash.
- Treat a source that appears only on one side as a problem, not as a silent
  pass.
- Apply the stored limit to Semantic Scholar citation sampling so the sampled
  counter set is the same one the run used.

## Consequences

- Replay now catches changes in retrieval mapping, deduplication and ranking.
- Verification drift is not replayed; it is a stored input. A future
  `recheck` command can re-run verification and compare.
- Runs without payloads, or with corrupted payloads, fail with a named problem.
- The normalisers are public functions with two callers, so retrieval and replay
  cannot drift apart silently.
