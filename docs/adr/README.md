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
