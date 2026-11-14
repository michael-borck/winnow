# 0022. Local web UI over a localhost server and session token

**Status:** Accepted
**Date:** 2026-11-11

## Context

The CLI is honest but a reading and triage interface is better with abstracts,
draft previews and a queue. A hosted web app would break the privacy promise and
add accounts. The spec already planned `packages/server` and `packages/web`.

## Decision

Ship a local-only web UI:

- `packages/server` is Express, binds `127.0.0.1:4317`, serves the built React
  app from `packages/web/dist`, and exposes JSON endpoints for state, sources,
  evidence, drafts and the hold queue.
- A per-session token is issued at `/api/session` and required on every
  state-changing request. No token is stored in the database.
- `packages/web` is React + Vite. Tabs: Sources, Evidence, Drafts and Queue.
  Screening writes go through the same core function as the CLI. Queue restores
  and drops create new draft revisions.
- Review generation stays on the CLI for now. The UI does not call a model.

## Consequences

- The browser is a client of the same core; it cannot drift from the CLI.
- The context is local, not a SaaS; the attack surface is limited to localhost
  and the token.
- Vite handles development; the server serves the built assets in production.
- Desktop can wrap the same web UI later.
- Review generation, a visual draft diff and multi-project switching are
  follow-ups.
