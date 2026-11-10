# Winnow

> Find, verify, and weigh the literature. Locally.

Winnow is a privacy-first literature search and review tool. Give it a topic, a
question, or a thesis. It searches open scholarly indexes, deduplicates and
verifies what it finds, shows you the abstracts, and can turn the verified set
into a grounded review draft with a citation on every claim.

The name is the job: separate the grain from the chaff, and show your working.

**Status:** v0.1 scaffold. The CLI implements `init`, `search`, `verify` and
`replay`; screening, extraction, drafting and the web/desktop surfaces are next.
v1 targets structured narrative and scoping reviews, not systematic reviews.
See [SPEC.md](SPEC.md) and [docs/reviews](docs/reviews/README.md).

**Website:** <https://winnow.borck.education>

## Quick start

```bash
npm install
npm run build
npm test

# Put the CLI on your PATH
npm link ./packages/cli

winnow init phd-review
cd phd-review
winnow search "retrieval augmented generation" --limit 20 --out exports/search.json
winnow verify 10.1038/s41586-020-2649-2
winnow replay <run-id>
```

`search` retrieves from OpenAlex and Crossref by default, deduplicates by DOI,
verifies each DOI independently through `@michaelborck/cite-sight-core` and
ranks with reciprocal rank fusion before applying `--limit`. A run saves its
raw provider payloads, sources, verification axes and ranked set to the
project's SQLite database. `replay` re-derives the deterministic snapshot and
compares hashes.

Formats: `--format table|json|csv|bibtex|csl`. A search without a project runs
ephemerally; `--no-save` does the same inside a project. `--provider openalex`
or `--provider crossref` restricts retrieval.

## What works now

- `winnow init` — project folder, `.winnow/project.json`, SQLite schema, local
  data ignored by git.
- `winnow search` — OpenAlex and Crossref retrieval, deduplication, orthogonal
  verification, citability, RRF ranking, payload storage, JSON/CSV/BibTeX/CSL
  export.
- `winnow verify` — a DOI or every DOI in a text file, with identity, match
  category, integrity notices, link status and citability.
- `winnow replay` — filesystem payload checks plus a deterministic snapshot
  hash comparison.
- Unit and integration tests across citability, dedupe, ranking, formatting,
  project lifecycle, database updates and replay.

Not yet: screening, extraction, grounded drafting, argument maps, counter-
evidence, link probing during search (use `--check-links`), full replay that
re-normalises stored payloads (current replay verifies payload hashes and
re-derives the stored snapshot), the local web UI and the desktop shell.

## Why another literature tool

Most tools either search, or write. Winnow does the unglamorous part in
between, and refuses to skip it:

- **Verified, not generated.** Every DOI is resolved, every record is checked
  against a registry, and landing pages can be probed. A language model never
  produces a reference.
- **Grounded, not fluent.** The model only transforms text retrieved from real
  sources. Every evidence sentence carries a source ID and a quoted span, every
  synthesis carries two or more, every gap claim comes from a corpus query, and
  framing prose carries no facts. Provenance is enforced; support is flagged
  for review, never assumed.
- **Local, not rented.** Your library, notes and drafts live in a SQLite file
  on your machine. A local model is the default. A frontier model is optional,
  bring-your-own-key, and never part of the correctness path.
- **Argued, not just listed.** Ask for the case against your thesis. Winnow
  finds counter-evidence through inverted queries, citation chasing and stance
  labelling, then shows its evidence for each label.

## Planned interfaces

| Interface | Status | Use |
|---|---|---|
| CLI | v0.1 scaffold | Search, verify, replay, batch, scripting |
| Local web UI | v0.4 | Browse, triage, read, edit |
| Desktop app | v0.5 | Same UI in a shell, for people who will not open a terminal |
| Library | v0.1 scaffold | `@michaelborck/winnow-core` for other tools |

## Documentation

- [SPEC.md](SPEC.md) — the product and technical specification
- [docs/adr](docs/adr/README.md) — architecture decision records
- [docs/reviews](docs/reviews/README.md) — external spec audits and disposition
- [site](site/README.md) — landing page and custom-domain notes
- [LICENSE](LICENSE) — MIT

## Relationship to sibling projects

Winnow is assembled from parts proven in `cite-sight` (verification, abstract
extraction, BibTeX export) and `honeyguide` (retrieve → verify → enrich →
rank pipeline, CLI-first monorepo). It does not fork either; it pins
`@michaelborck/cite-sight-core@0.13.3` and reuses the pipeline shape.
