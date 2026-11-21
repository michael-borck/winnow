# 0028. Optional grey-literature web search

**Status:** Accepted
**Date:** 2026-11-21

## Context

Winnow retrieves from scholarly indexes (OpenAlex, Crossref, Semantic Scholar
for citation chasing). The specification left grey-literature web search
undecided. Teachers and reviewers often need policy papers, practitioner
guides, and institutional pages that are not in those indexes.

## Decision

1. **Web search is optional and off by default.** It joins retrieval only when
   `web` is requested (`--web`, `--provider web`, or the UI grey-literature
   toggle).
2. **Providers are Brave, Serper and SearXNG.** They run in a configurable
   order (default `brave,serper,searxng`), fall through on empty or failed
   results, and share a 10-minute in-process cache.
3. **Web results are grey literature.** They are stored as `type: website`,
   have no DOI, verify as `unverified` + `not_indexed_expected`, and remain
   `not_citable` until a human attests them. They appear in screening so a
   reviewer can decide, but they never enter citation exports automatically.
4. **Keys are not persisted.** The CLI reads flags or environment variables.
   The desktop/web Search tab keeps keys in the current browser session and
   sends them only to the local server for that request. Keys are never written
   to SQLite, payloads, logs or exports.
5. **The local server stays local.** `POST /api/search` is behind the same
   session token and localhost Host check as every other API route. There is no
   multi-user hosted tier to rate-limit.

## Consequences

- Searches and payloads remain reproducible; the web payload is stored like
  any other provider payload.
- Grey literature is visible and screenable without weakening the citation
  rule.
- A future attestation flow can make selected web sources citable without
  changing retrieval.
