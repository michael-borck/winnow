# 0006. SQLite with FTS5; no vector database in v1

**Status:** Accepted
**Date:** 2026-11-11

## Context

A research project has tens to low hundreds of sources, each with metadata,
abstract, extraction fields and quotes. The obvious default in AI tooling is a
vector database, but retrieval here is API-driven, and the corpus is small
enough to search exactly.

## Decision

Use one SQLite database per project, via Node's built-in `node:sqlite`
(`DatabaseSync`, Node 24+), with FTS5 for local text search. Store JSON columns
for structured evidence. Do not add embeddings or a vector store in v1.

## Consequences

- One database file per project, easy to back up, inspect, diff and archive;
  raw payloads sit beside it for replay.
- No embedding model to download, no dimension mismatch, no index rebuild.
- Local semantic search over a large personal library is not available. If it
  becomes a requirement, add an optional embedding index alongside FTS5, keeping
  exact metadata search as the source of truth.
- Queries remain reproducible because they are stored as text, not reduced to
  vectors.
- `node:sqlite` is built in, so the CLI and server have no native module to
  compile. Electron's bundled Node may not expose it; if it does not, the
  desktop package falls back to `better-sqlite3` and rebuilds it per Electron
  version in v0.5.
