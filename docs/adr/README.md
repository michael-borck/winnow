# ADRs

Architecture decision records for Winnow, following the same convention as
`honeyguide` and `cite-sight`: one decision per file, status, context, decision,
consequences.

| ADR | Decision |
|---|---|
| [0001](0001-typescript-monorepo.md) | TypeScript monorepo, no Python sidecar in v1 |
| [0002](0002-verification-is-deterministic.md) | Verification is deterministic and model-independent |
| [0003](0003-local-first-model-policy.md) | Local model by default, BYOK optional, never in the correctness path |
| [0004](0004-counter-evidence-mechanisms.md) | Counter-evidence via query inversion, citation chasing and stance labelling |
| [0005](0005-hypothesis-is-optional.md) | The thesis or question is an optional brief, not a required interview |
| [0006](0006-sqlite-no-vector-db.md) | SQLite with FTS5; no vector database in v1 |
| [0007](0007-orthogonal-verification.md) | Orthogonal verification axes and one citability rule |
| [0008](0008-sentence-taxonomy.md) | Sentence taxonomy and post-generation checks |
| [0009](0009-review-scope.md) | Structured narrative and scoping reviews in v1 |
| [0010](0010-merge-rank-select.md) | Cross-provider merge, rank and selection |
| [0011](0011-replay-and-payloads.md) | Replay, re-execute and provider payload storage |
| [0012](0012-human-screening.md) | Human screening decisions, separate tool suggestions |
| [0013](0013-extraction-from-confirmed-includes.md) | Extraction only from confirmed includes; suggestions separate |
| [0014](0014-template-writer-and-checks.md) | Template writer first; deterministic checks before rendering |
| [0015](0015-stance-and-counter-evidence.md) | Human stance, derived argument map, separate counter-evidence run |
| [0016](0016-model-writer.md) | Model writer behind the same deterministic checks |
| [0017](0017-support-check.md) | Support check holds sentences; it never deletes them |
| [0018](0018-citeproc-styles.md) | Citeproc renders citations; source IDs remain the contract |
| [0019](0019-held-sentence-queue.md) | Held sentences are a queue; restores create a draft revision |
| [0020](0020-citation-chasing.md) | Citation chasing through Semantic Scholar contexts |
| [0021](0021-custom-csl.md) | Custom CSL files are registered and stored with the draft |
| [0022](0022-local-web-ui.md) | Local web UI over a localhost server and session token |
| [0023](0023-ui-template-review.md) | The UI generates template reviews; model and CSL stay in the CLI |
| [0024](0024-full-payload-replay.md) | Full payload replay with stored verification |
| [0025](0025-ui-model-and-csl-controls.md) | Model and CSL controls in the local UI; keys stay server-side |
| [0026](0026-electron-shell.md) | Electron shell starts the local server on a free port |
