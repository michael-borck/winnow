# Changelog

All notable changes to Winnow are documented here. The format follows Keep a
Changelog, and the project uses semantic versioning.

## [Unreleased]

### Added

- Optional grey-literature web search through Brave, Serper or SearXNG, with
  automatic fallback, a 10-minute cache, and per-provider pacing/backoff.
- CLI `--web` (or `--provider web`) plus `--brave-key`, `--serper-key`,
  `--searxng-url` and `--fallback-order`; environment equivalents are
  supported.
- A Search tab in the desktop/web UI with topic filters, a grey-literature
  toggle, session-only provider keys, and usage/cost guidance.
- `winnow doctor` reports `provider:web` and the search hosts Winnow may
  contact.
- `POST /api/search` saves a run from the desktop/web UI.

### Note

Web results are grey literature: no DOI, `not_indexed_expected`, and
`not_citable` until attested. They are for discovery and screening, not direct
citation.

## [1.1.0] - 2026-11-17

### Added

- Sidebar shell for the local web UI with project, run and section navigation
- About tab with method, privacy, limits and documentation links
- Evidence editing in the web UI, backed by a validated `POST /api/evidence`
  endpoint
- Copy Markdown and Download `.md` actions for drafts
- Component tests for the sidebar, About tab and evidence editing
- Accessible labels for evidence form fields

### Changed

- Improved keyboard accessibility: skip link, focus-visible styles, alert and
  status roles, focusable draft previews, and semantic landmarks
- Responsive sidebar that collapses to a horizontal nav on small screens

## [1.0.0] - 2026-11-17

### Added

- CLI commands: `export`, `rerun`, `doctor`, `project export`,
  `project delete --purge`, and `cache purge`
- `winnow search --counter` and a default search limit of 40
- Audit events for screening, extraction, stance, drafts, searches, counter
  runs, exports, cache purges and remote-model consent
- Model artifact verification for Ollama digests and quantization, with a
  fallback to OpenAI-compatible model lists
- Remote-model consent through the CLI `--allow-remote-model` flag, the web UI
  consent checkbox, and the server consent field
- Desktop installers for macOS, Windows and Linux, with icons, entitlements, a
  notarization hook and a first-run Ollama check
- Planted-error acceptance checks for drafting checks 1-5
- Fuzzy dedupe by title, author and year, plus variant linking for preprint and
  published versions
- Retry with backoff, response size caps and payload caps
- Per-provider pacing, polite-pool email, OpenAlex and Semantic Scholar API
  keys, and Retry-After support
- Server Host/Origin validation, token-protected reads, security headers and
  CSL input validation
- Span-exact quote checks, stance-aware synthesis, framing rules and citation
  fallback reporting

### Changed

- Schema version 9, with model artifacts and run model metadata
- Packaged builds bundle the server and web assets and resolve them from
  `process.resourcesPath`
- Version 1.0.0 across all packages

### Security

- The session token is required for all `/api` reads except `/api/session`
- Remote model endpoints require explicit consent
- Model base URLs are restricted to http(s) and cannot contain credentials
- CSL files reject DTDs, entities and oversized payloads
- The Electron renderer remains sandboxed and isolated

### Known limitations

- The Weigh stage is deferred; study design and quality flags are not computed
- SYNERGY and counter-evidence recall benchmarks are deferred; the planted-error
  checks 1-5 are in the test suite
- Local macOS signing is blocked by a macOS 25.6 AppleDouble/codesign issue;
  CI signing and notarization are configured