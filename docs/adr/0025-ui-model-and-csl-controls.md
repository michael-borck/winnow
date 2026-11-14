# 0025. Model and CSL controls in the local UI; keys stay server-side

**Status:** Accepted
**Date:** 2026-11-11

## Context

The local UI could generate template reviews but model drafting, support triage
and custom CSL still required the CLI. Users wanted the same controls in the
browser. Model keys are the risky part: a browser that holds a key can leak it
through storage, extensions or a screenshot.

## Decision

Extend `POST /api/review` and the Drafts tab:

- Accept `writer` (`template`/`model`), `model`, `baseUrl`, `support` and a
  custom `csl` XML string.
- The server reads `WINNOW_MODEL_API_KEY` or `OPENAI_API_KEY` from its own
  environment. The browser never receives, stores or sends a key.
- Model name and base URL live in browser state only; they are not persisted.
- A non-local base URL returns a warning and the UI displays it.
- Custom CSL is registered with citeproc, stored in the draft, and used for
  queue re-renders.
- Support triage is available when a model is configured; its outcomes are
  kept/marked/held exactly as in the CLI.
- Model connection failures return 502 with the upstream message.

## Consequences

- The UI can complete the review loop with either writer.
- Keys stay in the server environment, out of browser storage and the database.
- A user who points the base URL at a cloud provider sends the evidence bundle
  off-machine; the warning is explicit.
- Settings are not persisted between browser sessions; a settings panel with
  OS keychain integration is a future task.
- Argument drafts remain CLI-only for now.
