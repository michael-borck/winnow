# Winnow

[![CI](https://github.com/michael-borck/winnow/actions/workflows/ci.yml/badge.svg)](https://github.com/michael-borck/winnow/actions/workflows/ci.yml)

> Find, verify, and weigh the literature. Locally.

Winnow is a privacy-first literature search and review tool. Give it a topic, a
question, or a thesis. It searches open scholarly indexes, deduplicates and
verifies what it finds, shows you the abstracts, and can turn the verified set
into a grounded review draft with a citation on every claim.

The name is the job: separate the grain from the chaff, and show your working.

**Status:** v0.3 in progress. The CLI implements `init`, `brief`, `search`,
`screen`, `extract`, `stance`, `review`, `argue`, `counter`, `verify` and
`replay`; a template or local-model writer is available, while citeproc styles,
citation chasing and the web/desktop surfaces are next. v1 targets structured
narrative and scoping reviews, not systematic reviews. See [SPEC.md](SPEC.md)
and [docs/reviews](docs/reviews/README.md).

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
winnow screen . --suggest
winnow screen . --interactive
winnow extract . --suggest
winnow extract . --format csv --out exports/evidence.csv
winnow review . --out drafts/review.md
winnow stance . --thesis "Retrieval improves accuracy." --suggest
winnow argue . --thesis "Retrieval improves accuracy." --out drafts/argument.md
winnow counter . --topic "retrieval augmented generation" --thesis "Retrieval improves accuracy."
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

## Briefs

A brief is YAML frontmatter plus optional context. Machine filters are kept
separate from criteria a human judges.

```yaml
---
mode: review
question: Does retrieval-augmented generation reduce citation fabrication?
thesis: Verified retrieval reduces fabrication in literature reviews.
scope:
  date_range: 2018..2026
  disciplines: [computer science]
filters:
  types: [journal-article, preprint]
  languages: [en]
  open_access: true
  exclude_keywords: [press release, pilot study]
  exclude_venues: [Predatory Journal]
  exclude_domains: [example.com]
  exclude_types: [editorial]
criteria:
  include:
    - studies measuring citation accuracy
  exclude:
    - opinion pieces
counter: false
---
Context the writer may use when drafting.
```

```bash
winnow brief briefs/question.md
winnow search --brief briefs/question.md --limit 20
```

Explicit CLI flags override brief filters. `winnow brief --format json` prints
the parsed structure. `exclude_*` filters are screening flags, not retrieval
filters: `winnow screen --brief` shows and counts them, and `--drop-excluded`
hides them only after the count. See [SPEC.md](SPEC.md) for the full schema.

## Screening

Screening is a human decision, not a tool verdict. The tool stores a suggestion
separately from the decision; the human can always override it. Decisions are
append-only and carry a reviewer, timestamp, priority (`core`, `supporting` or
`peripheral`) and a reason code.

```bash
winnow screen . --suggest                  # store heuristic suggestions
winnow screen . --interactive              # quick triage
winnow screen . --format csv --out decisions.csv
winnow screen . --decisions decisions.csv  # import from a spreadsheet
```

Brief exclusions are flags, not silent removals. `exclude_keywords`,
`exclude_venues`, `exclude_domains` and `exclude_types` appear in the summary
and count as `filtered out`; `--drop-excluded` hides them after you have seen
the count. A human include always wins.

## Extraction

Only human-confirmed includes feed the evidence table. The tool can suggest
fields, but a suggestion is stored separately and a human confirmation is a new
row.

```bash
winnow extract . --suggest
winnow extract . --interactive
winnow extract . --format csv --out exports/evidence.csv
winnow extract . --decisions exports/evidence.csv
```

Fields default to `population,method,sample,finding,limitation,quote` and can
be changed with `--fields`. The heuristic extractor is deliberately simple and
explainable; a local model can add suggestions later without changing the
confirmed-value store.

## Drafting

`winnow review` builds an evidence bundle from confirmed values with quotes,
then writes a template draft. Only kept sentences reach the Markdown; dropped
sentences are listed with the check that failed.

```bash
winnow review . --out drafts/review.md
winnow review . --writer model --model qwen3:8b --out drafts/review.md
winnow review . --format json --out drafts/review.json
```

Checks 1–5 are deterministic: schema, citable IDs, verbatim quotes, numbers
present in quotes or recomputed coverage counts, and synthesis shape. Check 6
(support entailment) is not run without a support model and says so.

The model writer speaks to any OpenAI-compatible endpoint. The default is a
local Ollama endpoint at `http://localhost:11434/v1`; use `--base-url` for LM
Studio, llama.cpp or a remote provider. The model receives only the evidence
bundle: no full corpus, no other sources. Malformed output is rejected, and
every returned sentence still runs through checks 1–5. A non-local base URL
prints a warning because the evidence bundle leaves the machine.

## Stance and argument

Stance is relative to a thesis and human-confirmed. The tool can suggest a
label, but the suggestion is stored separately and never overwrites a decision.

```bash
winnow stance . --thesis "Retrieval improves accuracy." --suggest
winnow stance . --thesis "Retrieval improves accuracy." --interactive
winnow stance . --thesis "Retrieval improves accuracy." --format csv --out exports/stances.csv
winnow argue . --thesis "Retrieval improves accuracy." --out drafts/argument.md
```

`winnow argue` builds an argument map from included sources with confirmed
stances: supporting, opposing, mixed and unclear. It generates supporting and
counter-evidence sections, a divided synthesis when both sides exist, and a
"What would change the conclusion" section. `--allow-suggested` uses suggestion
labels where a human label is missing, and says so in the draft.

`winnow counter` runs a separate search with critical terms (`limitations`,
`critique`, `"no evidence"`, `"fails to"`, `"replication failure"`,
`criticism`) and saves it as a new run. Pass `--thesis` to seed stance
suggestions for the counter set, then screen and confirm as usual.

```bash
winnow counter . --topic "retrieval augmented generation" \
  --thesis "Retrieval improves accuracy." --limit 20
```

## What works now

- `winnow init` — project folder, `.winnow/project.json`, SQLite schema, local
  data ignored by git.
- `winnow brief` — parse and validate a YAML brief, with warnings for unknown
  fields and machine filters separated from judged criteria.
- `winnow search` — OpenAlex and Crossref retrieval, deduplication, orthogonal
  verification, citability, RRF ranking, payload storage, JSON/CSV/BibTeX/CSL
  export. `--brief` supplies the topic and filters.
- `winnow screen` — append-only human decisions, separate heuristic suggestions,
  three priority tiers, reason codes, brief-exclusion flags and counts, and
  CSV/JSON import-export.
- `winnow extract` — human-confirmed evidence rows with quotes, separate tool
  suggestions, configurable fields and CSV/JSON round-trip. Only confirmed
  includes are extracted.
- `winnow review` — evidence bundle, template or local-model writer,
  deterministic checks 1–5, kept/dropped report, references and an evidence
  appendix.
- `winnow stance` — human stance labels relative to a thesis, separate heuristic
  suggestions, and CSV/JSON import-export.
- `winnow argue` — argument map and draft with supporting, opposing, mixed and
  unclear sections, plus a checks-filtered synthesis. The model writer is
  available here too.
- `winnow counter` — a separate critical-terms search run that seeds
  counter-evidence candidates and optional stance suggestions.
- `winnow verify` — a DOI or every DOI in a text file, with identity, match
  category, integrity notices, link status and citability.
- `winnow replay` — filesystem payload checks plus a deterministic snapshot
  hash comparison.
- Unit and integration tests across briefs, screening, extraction, stance,
  drafting, argument maps, model output validation, citability, dedupe, ranking,
  formatting, project lifecycle, database updates and replay.

Not yet: citeproc-based citation styles, citation chasing for counter-evidence,
link probing during search (use `--check-links`), full replay that re-normalises
stored payloads (current replay verifies payload hashes and re-derives the
stored snapshot), the local web UI and the desktop shell.

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
| CLI | v0.3 in progress | Search, screen, extract, stance, review, argue, counter, verify, replay |
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
