# 0001. TypeScript monorepo, no Python sidecar in v1

**Status:** Accepted
**Date:** 2026-11-11

## Context

Winnow needs retrieval clients, verification, abstract handling, BibTeX export,
a CLI, a local server, a web UI and a desktop shell. `cite-sight-core` already
implements the hardest part — verification against six scholarly registries —
in TypeScript and publishes it as npm. `honeyguide` proves the monorepo shape
across CLI, server, web and desktop.

The alternative is Python, which has stronger PDF and ML tooling (GROBID,
marker, sentence-transformers) and is common in the research-tools ecosystem.

## Decision

Use TypeScript for the core, CLI, server, web and desktop packages. Depend on
`@michaelborck/cite-sight-core` rather than porting verification. Do not add a
Python sidecar in v1.

## Consequences

- One language spans every surface; the CLI and server share the exact same
  core.
- Verification improvements in `cite-sight` flow to Winnow for free.
- PDF parsing and local embeddings are weaker than in Python. If they become
  necessary, add an isolated FastAPI sidecar for those jobs only, never a second
  implementation of the pipeline.
- Contributors need Node 20+, not a Python environment.
