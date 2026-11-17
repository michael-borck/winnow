# Winnow

[![CI](https://github.com/michael-borck/winnow/actions/workflows/ci.yml/badge.svg)](https://github.com/michael-borck/winnow/actions/workflows/ci.yml)

> Find, verify, and weigh the literature. Locally.

Winnow is a privacy-first literature search and review tool. Give it a topic, a
question, or a thesis. It searches open scholarly indexes, deduplicates and
verifies what it finds, shows you the abstracts, and can turn the verified set
into a grounded review draft with a citation on every claim.

The name is the job: separate the grain from the chaff, and show your working.

**Status:** v1.0.0. The CLI implements `init`, `brief`, `search`, `screen`,
`extract`, `export`, `stance`, `review`, `argue`, `counter`, `queue`, `verify`,
`replay`, `rerun` and `doctor`; template or local-model writers, support triage,
citeproc styles, citation chasing, custom CSL files, full payload replay, a
local web UI and a desktop shell are available. Installers and notarization are
wired for CI. v1 targets structured narrative and scoping reviews, not
systematic reviews. See
[SPEC.md](SPEC.md) and [docs/reviews](docs/reviews/README.md).

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
winnow counter . --of 10.1038/s41586-020-2649-2 --thesis "Retrieval improves accuracy."
winnow review . --csl journal.csl --out drafts/review.md
winnow verify 10.1038/s41586-020-2649-2
winnow replay <run-id>
winnow rerun <run-id> --live --diff
winnow doctor
```

`search` retrieves from OpenAlex and Crossref by default, deduplicates by DOI
and then by normalised title, first author and year, links preprint and
published versions as variants, verifies each DOI independently through
`@michaelborck/cite-sight-core` and ranks with reciprocal rank fusion before
applying `--limit`. Provider calls retry with backoff on 429 and 5xx, responses
are size-capped, and stored payloads are capped at 2 MB each and 250 MB per
project. A run saves its raw provider payloads, sources, verification axes and
ranked set to the project's SQLite database. `replay` re-derives the
deterministic snapshot and compares hashes.

`rerun <run-id> --live` re-executes the same query against current providers and
reports drift: added, removed and changed sources, rank and selection changes,
citability and verification changes, and provider failures. `--diff` lists each
source, and `--format json` prints the full report. The comparison is recorded as
an audit event on the original run.

Formats: `--format table|json|csv|bibtex|csl`. A search without a project runs
ephemerally; `--no-save` does the same inside a project. `--provider openalex`
or `--provider crossref` restricts retrieval.

## Search providers

Winnow searches OpenAlex and Crossref by default and uses Semantic Scholar for
citation chasing. Provider calls are paced at about one request per second per
provider, retry 429 and 5xx responses with backoff, and honour `Retry-After`.

- `--mailto` or `WINNOW_MAILTO` puts OpenAlex and Crossref requests in the
  polite pool.
- `--openalex-key` or `OPENALEX_API_KEY` raises OpenAlex's free allowance.
- `--s2-key` or `SEMANTIC_SCHOLAR_API_KEY` raises Semantic Scholar's rate
  limits for citation chasing.
- Keys come from the CLI or environment and are never stored in the database,
  logs or exports.

Paid indexes such as Scopus and Web of Science are out of scope: they require
institutional authentication and licence agreements. Winnow is built around
open indexes.

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

## Export

`winnow export` writes stored data without re-running the pipeline. It uses the
latest completed run by default.

```bash
winnow export . --kind sources --format bibtex --out exports/sources.bib
winnow export . --kind sources --format json --all --out exports/sources.json
winnow export . --kind evidence --format csv --out exports/evidence.csv
winnow export . --kind draft --format markdown --out drafts/review.md
```

`--kind` is `sources`, `evidence` or `draft`. Source exports default to JSON and
accept `table`, `json`, `csv`, `bibtex` and `csl`; `--all` includes unselected
sources. Evidence exports default to CSV and accept `table`, `json` and `csv`.
Draft exports default to Markdown and accept `markdown` and `json`; `--draft
<id>` implies `--kind draft` and picks a revision, and `--run <id>` picks the
run.

## Diagnostics

`winnow doctor` checks Node, the project database, provider APIs, the local
model endpoint and key presence. It also prints the hosts Winnow may contact.
Key values are never printed.

```bash
winnow doctor
winnow doctor --offline
winnow doctor --base-url http://localhost:1234/v1 --model qwen3:8b
winnow doctor --format json --out doctor.json
```

`--offline` skips provider and model network checks. A missing local model is a
warning, not a failure. A failed provider or database check exits 1.

## Project data

`winnow project export` writes a portable `.tar.gz` of the project folder,
including the database and payloads. `winnow project delete --purge` removes the
project and its local data. `winnow cache purge` deletes stored payloads but
keeps the database and drafts.

```bash
winnow project export . --out ../winnow-review.tar.gz
winnow cache purge
winnow project delete old-review --purge --yes
```

`cache purge` keeps the `raw_payloads` rows, so `winnow replay` reports the
missing payloads rather than pretending the run is intact.

## Drafting

`winnow review` builds an evidence bundle from confirmed values with quotes,
then writes a template draft. Only kept sentences reach the Markdown; dropped
sentences are listed with the check that failed.

```bash
winnow review . --out drafts/review.md
winnow review . --writer model --model qwen3:8b --out drafts/review.md
winnow review . --writer model --model qwen3:8b --support --out drafts/review.md
winnow review . --style vancouver --out drafts/review.md
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
requires `--allow-remote-model`; the CLI prints the host and the number of
claims and sources it will send. The web UI uses an explicit consent checkbox
before it will send the bundle to a remote endpoint.

`--support` adds a second, separate entailment pass. Each evidence sentence is
checked against its quotes and labelled `supported`, `partial`, `unsupported`
or `contradicted`. Unsupported and contradicted sentences are held out of the
draft and listed for review; partial support is marked inline. A failed support
call leaves the sentence in place and reports that the check did not run.

`--style` renders in-text citations and the reference list with citeproc:
`apa` (default), `vancouver` or `harvard`. `--csl <file>` registers a custom CSL
style and uses it for that draft. The CSL engine is citation-js, so chapter,
report, thesis and conference types map correctly.

## Review queue

Held sentences are not deleted. `winnow queue` lists them with the support
rationale; a human can restore one or accept the hold. A restore creates a new
draft revision, so the earlier draft and the override stay in the history.

```bash
winnow queue .
winnow queue . --restore <sentence-id> --rationale "Relevant, but weaker than claimed"
winnow queue . --drop <sentence-id>
winnow queue . --format json
```

## Local web UI

The local UI covers sources, evidence, drafts and the hold queue. It binds to
`127.0.0.1`, and state-changing requests carry a per-session token fetched from
the server.

```bash
npm run build
node packages/server/dist/index.js --project=.
# open http://127.0.0.1:4317
```

For development, run the API and Vite separately:

```bash
npm run dev:server
npm run dev:web
# open http://127.0.0.1:5173
```

The Drafts tab can generate a template or local-model review for the selected
run, run the support pass, use a named style or a custom CSL file, and compare a
revision with its parent side by side. API keys come from the server environment
(`WINNOW_MODEL_API_KEY` or `OPENAI_API_KEY`); the browser never receives them,
and a non-local base URL requires an explicit consent checkbox before the
evidence bundle leaves the machine.

## Desktop shell

`npm run desktop` builds the packages, starts the local server on a free port
and opens the same UI in an Electron window. If no project is given, it asks for
a project folder.

```bash
npm run desktop
WINNOW_PROJECT=/path/to/project npm run desktop
```

The window has no Node integration and loads only the localhost server. The
shell stops the server when the app quits. Installers and notarization are not
wired up yet; this is a development shell.

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

`--of <doi>` switches to citation chasing through Semantic Scholar: it fetches
the papers that cite the DOI, keeps their citation contexts, samples the
critical contexts first, verifies the resulting records and saves them as a
counter run.

```bash
winnow counter . --of 10.1038/s41586-020-2649-2 \
  --thesis "Retrieval improves accuracy." --limit 20
```

## What works now

- `winnow init` — project folder, `.winnow/project.json`, SQLite schema, local
  data ignored by git.
- `winnow brief` — parse and validate a YAML brief, with warnings for unknown
  fields and machine filters separated from judged criteria.
- `winnow search` — OpenAlex and Crossref retrieval, deduplication, orthogonal
  verification, citability, RRF ranking, payload storage, JSON/CSV/BibTeX/CSL
  export. `--brief` supplies the topic and filters; `--counter` also saves a
  separate critical-terms run. `--mailto`, `--openalex-key`, polite-pool email
  and per-provider pacing keep requests within provider limits.
- `winnow screen` — append-only human decisions, separate heuristic suggestions,
  three priority tiers, reason codes, brief-exclusion flags and counts, and
  CSV/JSON import-export.
- `winnow extract` — human-confirmed evidence rows with quotes, separate tool
  suggestions, configurable fields and CSV/JSON round-trip. Only confirmed
  includes are extracted.
- `winnow export` — stored sources, evidence or a draft in table, JSON, CSV,
  BibTeX, CSL or Markdown, with `--all` for unselected sources and `--draft` for
  a specific revision.
- `winnow review` — evidence bundle, template or local-model writer,
  deterministic checks 1–5, optional support entailment pass, kept/marked/held/
  dropped report, citeproc citations and an evidence appendix. `--csl` accepts a
  custom style. The model writer records the artifact digest and quantization
  when the endpoint exposes them.
- Model artifacts — Ollama digests and quantization are stored in
  `model_artifacts`; other OpenAI-compatible endpoints are checked for
  availability but usually cannot provide a digest.
- `winnow stance` — human stance labels relative to a thesis, separate heuristic
  suggestions, and CSV/JSON import-export.
- `winnow argue` — argument map and draft with supporting, opposing, mixed and
  unclear sections, plus a checks-filtered synthesis. The model writer is
  available here too.
- `winnow counter` — a separate critical-terms search run, or `--of <doi>`
  citation chasing through Semantic Scholar, that seeds counter-evidence
  candidates and optional stance suggestions.
- `winnow queue` — lists held sentences and restores or accepts them, creating a
  new draft revision with a recorded reviewer and rationale.
- `winnow verify` — a DOI or every DOI in a text file, with identity, match
  category, integrity notices, link status and citability.
- `winnow replay` — re-normalises every stored provider payload (OpenAlex,
  Crossref, Semantic Scholar), re-dedupes and re-ranks with the stored
  verification, and compares the snapshot hash. Corruption and drift are
  reported as problems.
- `winnow rerun` — re-executes a run against current providers and reports
  source, rank, selection, citability and verification drift. `--diff` lists
  each change, `--format json` prints the full report, and the comparison is
  stored as an audit event.
- Audit trail — screening, extraction, stance, draft saves, searches, counter
  runs, project exports, and cache purges are recorded in `audit_events`.
- `winnow doctor` — checks Node, project database integrity, provider
  reachability, the model endpoint, key presence and the hosts Winnow may
  contact. `--offline` skips network checks and key values are never printed.
- `winnow project export` / `project delete --purge` / `cache purge` — portable
  project archives, explicit project deletion, and payload cache purging that
  keeps the database.
- **Local web UI** — sources, evidence, drafts and queue at `127.0.0.1:4317`,
  with a session token for writes. The Drafts tab can generate a template or
  model review, run support triage, use a named or custom CSL, and compare a
  revision with its parent.
- **Desktop shell** — Electron window around the local UI; starts the server on
  a free port and stops it on quit.
- Unit and integration tests across briefs, screening, extraction, stance,
  drafting, argument maps, model output validation, support triage, citation
  styles, review queue, citation chasing, citability, dedupe, ranking,
  formatting, project lifecycle, database updates and replay.

Not yet: a richer visual draft diff. The Weigh stage is specified but deferred;
study design and quality flags are not computed. SYNERGY and counter-evidence
recall benchmarks are also deferred; the planted-error checks 1-5 are in the
test suite.

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
| CLI | v1.0 | Search, screen, extract, export, stance, review, argue, counter, queue, verify, replay, rerun, doctor |
| Local web UI | v1.0 | Browse, triage, read drafts, restore holds |
| Desktop app | v1.0 | Electron shell and installers for macOS, Windows and Linux |
| Library | v1.0 | `@michaelborck/winnow-core` for other tools |

## Documentation

- [SPEC.md](SPEC.md) — the product and technical specification
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [docs/method.md](docs/method.md) — how the review method works and the guidance it follows
- [docs/adr](docs/adr/README.md) — architecture decision records
- [docs/reviews](docs/reviews/README.md) — external spec audits and disposition
- [site](site/README.md) — landing page and custom-domain notes
- [LICENSE](LICENSE) — MIT

## Relationship to sibling projects

Winnow is assembled from parts proven in `cite-sight` (verification, abstract
extraction, BibTeX export) and `honeyguide` (retrieve → verify → enrich →
rank pipeline, CLI-first monorepo). It does not fork either; it pins
`@michaelborck/cite-sight-core@0.13.3` and reuses the pipeline shape.
