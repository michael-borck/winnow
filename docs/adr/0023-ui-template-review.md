# 0023. The UI generates template reviews; model and CSL stay in the CLI

**Status:** Accepted
**Date:** 2026-11-11

## Context

The first local web UI could triage sources, read evidence and manage holds, but
it could not create a draft. The CLI could, which left an awkward gap: the user
had to leave the browser to finish the loop. At the same time, model selection,
API keys and custom CSL files are configuration-heavy and better handled by an
explicit command.

## Decision

Add `POST /api/review` for the template writer only.

- Build the evidence bundle from the selected run.
- Generate the template draft, run checks 1–5, render with a named style
  (`apa`, `vancouver`, `harvard`) and save the bundle snapshot.
- Expose a "Generate template review" button and a style selector in the Drafts
  tab.
- Show a parent/child side-by-side comparison for draft revisions.
- Keep the model writer, custom CSL files and argument drafts in the CLI.

## Consequences

- The local UI can complete the screen → evidence → draft → queue loop.
- Model keys and CSL files are not handled in browser configuration yet.
- The server and CLI use the same core functions, so generated drafts are
  identical for the same bundle and style.
- A settings panel for model and style selection is a future UI task.
