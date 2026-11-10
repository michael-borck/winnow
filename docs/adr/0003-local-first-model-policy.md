# 0003. Local model by default, BYOK optional, never in the correctness path

**Status:** Accepted
**Date:** 2026-11-11

## Context

Privacy-first means the default must not send a research question to a cloud
provider. But local models are smaller and more likely to paraphrase badly or
miss nuance. Correctness matters more than prose quality here.

## Decision

- Default to a local model through Ollama or any OpenAI-compatible endpoint.
- Support bring-your-own-key for a frontier model, for prose and hard
  extraction only.
- Never bundle keys, never persist keys in the database, never log them.
- Keep every model task out of the verification path.
- Give every model task a deterministic fallback where one exists, and mark the
  output when the fallback was used. Fallbacks for extraction and outline are
  degraded, not equivalent.

## Consequences

- A user with no model still gets Explore, verification and export. Screening,
  extraction and outline fall back to deterministic, degraded modes that are
  marked in the run report; drafting prose is unavailable.
- Draft quality varies with the model, but the citation checker enforces the
  same floor: every kept sentence has a real source and a real quote.
- Frontier-model users get better prose, not better evidence.
