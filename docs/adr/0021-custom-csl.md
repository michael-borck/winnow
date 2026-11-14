# 0021. Custom CSL files are registered and stored with the draft

**Status:** Accepted
**Date:** 2026-11-11

## Context

APA, Vancouver and Harvard cover many cases but not a journal's house style.
Citeproc accepts CSL XML, so a user can supply a style file. The draft must
remain reproducible after it is saved and later re-rendered by the queue.

## Decision

Add `--csl <file>` to `review` and `argue`.

- Read the CSL XML, validate the basic `<style>` shape, and register it with
  citation-js under a content-derived name.
- Use that style for in-text citations and the reference list.
- Store the style name and the XML with the structured draft.
- On queue re-render, register the stored XML again before rendering.
- Reject `--style` and `--csl` together; a custom file overrides the named
  style.
- Fall back to visible source IDs if citeproc fails.

## Consequences

- A journal style can be used without patching Winnow.
- Drafts carry the style they were rendered with, so revisions do not drift.
- The XML is stored locally; it is not sent to a model.
- A malformed CSL file fails before drafting, not halfway through a render.
