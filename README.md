# Winnow

> Find, verify, and weigh the literature. Locally.

Winnow is a privacy-first literature search and review tool. Give it a topic, a
question, or a thesis. It searches open scholarly indexes, deduplicates and
verifies what it finds, shows you the abstracts, and can turn the verified set
into a grounded review draft with a citation on every claim.

The name is the job: separate the grain from the chaff, and show your working.

**Status:** specification stage. Nothing here runs yet. See [SPEC.md](SPEC.md).

## Why another literature tool

Most tools either search, or write. Winnow does the unglamorous part in
between, and refuses to skip it:

- **Verified, not generated.** Every DOI is resolved, every record is checked
  against a registry, every link is probed. A language model never produces a
  reference.
- **Grounded, not fluent.** The model only transforms text retrieved from real
  sources. Every sentence in a draft carries a source ID and a quoted span.
  No source, no sentence.
- **Local, not rented.** Your library, notes and drafts live in a SQLite file
  on your machine. A local model is the default. A frontier model is optional,
  bring-your-own-key, and never part of the correctness path.
- **Argued, not just listed.** Ask for the case against your thesis. Winnow
  finds counter-evidence through inverted queries, citation chasing and stance
  labelling, then shows its evidence for each label.

## Planned interfaces

| Interface | Status | Use |
|---|---|---|
| CLI | v0.1 | Search, screen, draft, batch, scripting |
| Local web UI | v0.4 | Browse, triage, read, edit |
| Desktop app | v0.5 | Same UI in a shell, for people who will not open a terminal |
| Library | from v0.1 | `@michaelborck/winnow-core` for other tools |

## Documentation

- [SPEC.md](SPEC.md) — the product and technical specification
- [docs/adr](docs/adr/README.md) — architecture decision records
- [LICENSE](LICENSE) — MIT

## Relationship to sibling projects

Winnow is assembled from parts proven in `cite-sight` (verification, abstract
extraction, BibTeX export) and `honeyguide` (retrieve → verify → enrich →
rank pipeline, CLI-first monorepo). It does not fork either; it depends on
`@michaelborck/cite-sight-core` and reuses the pipeline shape.
