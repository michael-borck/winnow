# 0016. Model writer behind the same checks

**Status:** Accepted
**Date:** 2026-11-11

## Context

The template writer proves the evidence pipeline but reads like a form. A local
model can produce better prose without changing the evidence. The risk is
obvious: a fluent model can invent a source, a quote or a number, and a reader
will believe it more than a clumsy template.

## Decision

Add `--writer model` and keep the template as the default.

- Use an OpenAI-compatible `/chat/completions` endpoint. Default base URL is
  Ollama at `http://localhost:11434/v1`; `--base-url` covers LM Studio,
  llama.cpp and remote providers.
- Send only the evidence bundle: claims, source metadata and counts. No full
  corpus, no unrelated sources, no files.
- Require JSON mode and temperature 0. The output shape is title plus sentences,
  each with type, citations, quotes and optional coverage.
- Reject malformed output. Do not repair a missing citation, quote, type or
  coverage object.
- Run checks 1–5 on the model output exactly as on the template output. Drop
  sentences that fail and show why.
- Store the writer and model name with the draft.
- Print a warning when the base URL is not local. Keys come from
  `WINNOW_MODEL_API_KEY` or `OPENAI_API_KEY` and are never stored.

## Consequences

- A local model can improve prose without gaining authority over evidence.
- The model is not in the correctness path: verification, screening, extraction
  and stance remain deterministic or human.
- A weak local model may produce many dropped sentences. That is visible, not
  hidden; the template is still available.
- Check 6 (support entailment) remains a separate support model, not the writer.
- Citeproc-based styles and citation chasing remain follow-ups.
