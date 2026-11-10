# 0011. Replay, re-execute and provider payload storage

**Status:** Accepted
**Date:** 2026-11-11

## Context

The first spec claimed a run could be reproduced "from its audit log alone"
while storing only identifiers and hashes. Live indexes drift, citation counts
change, local model output varies with quantization and hardware even at
temperature 0, and Ollama tags are mutable. Hashes detect drift; they do not
reproduce a run.

## Decision

Store compressed provider payloads (`RawPayload`) for every retrieval, plus the
model artifact digest, quantization, prompt-template version and decoding
parameters. Split reproducibility into two tested claims:

- **Replay:** deterministic stages re-derive byte-identical output from stored
  inputs.
- **Re-execute:** a live rerun runs against current providers and produces a
  drift report.

Caps default to 2 MB per payload and 250 MB per project. `winnow cache purge`
removes payloads and caches without deleting metadata. `winnow project export`
includes the database and payloads; `winnow project delete --purge` removes both.

## Consequences

- Replay is testable acceptance criteria, not a slogan.
- Storage grows with retrieval, bounded by the caps and purge command.
- Provider terms of service and licence fields must be respected when storing
  payloads and source text.
- Model output remains non-deterministic; only the deterministic stages promise
  byte-identical replay.
