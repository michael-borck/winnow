# Winnow: Project Specification

**Status:** draft for review
**Date:** 11 November 2026
**Repo:** `winnow`
**Binary:** `winnow`
**Packages:** `@michaelborck/winnow-core`, `@michaelborck/winnow-cli`
**License:** MIT

> Find, verify, and weigh the literature. Locally.

---

## 1. Purpose

Winnow is a privacy-first tool for finding, verifying, screening and
synthesising scholarly literature. It starts from a topic, a research question,
or a thesis, and produces:

1. a verified list of sources with abstracts, or
2. a screened and extracted evidence table, or
3. a grounded literature review draft, or
4. an argument map with evidence for and against a thesis.

Every source is verified against a scholarly registry. Every generated
sentence is traceable to a quoted span in a retrieved source. The model writes;
it does not invent references.

## 2. The problem

Existing tools split into two unsatisfying halves:

- **Search tools** (Google Scholar, OpenAlex, Scopus) return lists. They do not
  help you screen, extract, weigh or write.
- **LLM research tools** (deep-research clones, NotebookLM) write fluently from
  whatever they retrieved, and sometimes from what they remember. Citation
  fabrication is a known failure mode, and the whole pipeline usually depends
  on a paid cloud model.

Researchers need the missing middle: retrieval that is grounded, verification
that is deterministic, screening that is auditable, and drafting that cannot
invent a source. Privacy matters because a literature review often reveals an
unpublished thesis, a grant application, or a critique of a named colleague.

## 3. Non-goals

- Not a reference manager. Winnow does not store or annotate PDFs as a library;
  Zotero does that well. It imports from and exports to Zotero-compatible
  formats.
- Not an academic-integrity checker. That is `cite-sight`.
- Not a hosted multi-tenant SaaS. The local machine is the product.
- Not a plagiarism detector.
- Not a full-text crawler in v1. It works from metadata and abstracts, and
  optionally from open-access full text where a licence permits.
- Not a generator of references. It only exports what a registry confirmed.

## 4. Users and surfaces

| User | Primary need | Surface |
|---|---|---|
| Researcher / academic | Turn a question into a defensible review | CLI, then local web |
| Higher-degree student | Find and understand the field without fabrication | Local web, desktop |
| Lecturer | Build a reading list with counterpoints | CLI, web |
| Analyst / consultant | Evidence table for a report | CLI, CSV/JSON export |
| Tool builder | Reuse the verification and evidence engine | `winnow-core` library |

**v1 is CLI first.** It is the fastest way to prove the pipeline, it supports
batch work, and it forces the data model to be explicit. The local web UI and
desktop shell wrap the same core and the same JSON contract; neither is allowed
to contain logic the CLI lacks.

## 5. Design principles

1. **Verification is deterministic and model-independent.** The model never
   decides whether a paper exists. DOI resolution, registry matching and URL
   checks are code.
2. **No source, no sentence.** Every generated claim carries a source ID and a
   quoted span. Unsupported sentences are removed, not softened.
3. **Local by default.** Data lives in a local SQLite file. Network access is
   limited to public scholarly APIs. A local model is the default; a frontier
   model is optional and never in the correctness path.
4. **Every judgement is labelled and reversible.** Screening, stance and
   extraction are suggestions until a human confirms. Suggestions and decisions
   are stored separately.
5. **Degrade honestly.** If a provider fails, the run continues and reports
   which component failed. Partial results are labelled, never padded.
6. **Reproducible by construction.** Every run stores its queries, parameters,
   provider responses (identifiers and hashes, not full payloads), model name
   and version, and every decision with a timestamp.

## 6. Modes

Modes are composable stages, not separate apps. A run can stop after any stage
and resume later.

### 6.1 Explore

Input: a topic or question.
Output: a deduplicated, verified list of sources with title, authors, year,
venue, DOI, abstract, open-access link, citation count, retraction status and
source type.

This is the "list abstracts only" mode. No model is required.

### 6.2 Screen

Input: an existing reference file (BibTeX, RIS, CSV, JSON), or the output of
Explore.
Output: include / exclude / maybe decisions, exclusion reasons, tags, and
PRISMA-style counts.

A human makes the final decision. A model may propose; it may not decide.

### 6.3 Extract

Input: a screened set.
Output: a structured evidence table. Fields are configurable; the default set is
`population`, `method`, `sample`, `finding`, `limitation`, `quote`.

Each field value carries the source ID and, where a full text is available, a
page or character span.

### 6.4 Review

Input: a screened and extracted set, plus an optional brief.
Output: a literature review draft in Markdown, with inline citations to the
evidence table and a generated reference list. Sections follow the brief; the
default is background → themes → disagreements → gaps → conclusion.

### 6.5 Argue

Input: a thesis plus a screened set.
Output: an argument map (`for`, `against`, `unclear`) and a draft that states
the thesis, presents the strongest evidence on each side, addresses the
strongest counterargument, and states what would change the conclusion.

The thesis is optional. Without it, Winnow runs Explore or Review. With it, the
tool groups sources by stance and drafts toward the argument. Interactive
questioning is a later web/TUI feature, not a v1 CLI requirement.

### 6.6 Counter-evidence

Counter-evidence is a facet available in Explore, Review and Argue, not a
separate product. It finds material that challenges a framing through three
grounded mechanisms:

1. **Query inversion.** Generate critical queries from the topic or thesis
   (`limitations`, `critique`, `no evidence`, `contrary`, `replication
   failure`, `fails to`). Use a model when available, a term-expansion
   heuristic otherwise.
2. **Citation chasing.** Find papers that cite the target paper (OpenAlex
   `cited_by`, Semantic Scholar citations). Critics almost always cite what
   they criticise. Where the provider supplies citation contexts, keep them.
3. **Stance labelling.** Classify each retrieved abstract as `supports`,
   `opposes`, `mixed` or `unclear`, with a required supporting quote. This is a
   suggestion, labelled "candidate counter-evidence", and a human confirms it.

Counter-evidence runs through the identical verify-and-enrich path. It is
capped at roughly one third of the result set so it cannot crowd out the main
search, and coverage is reported honestly when few counterpoints are found.

## 7. Pipeline

```
brief (optional)
   │
   ▼
[0] Plan queries ──────── model or heuristic
   │
   ▼
[1] Retrieve ──────────── OpenAlex, Crossref, S2, arXiv, Europe PMC, DataCite
   │                       (+ optional SearXNG/Brave for grey literature)
   ▼
[2] Deduplicate ───────── DOI exact, then fuzzy title + author + year
   │
   ▼
[3] Verify ────────────── cite-sight-core: DOI resolution, registry match,
   │                       retraction, URL liveness, blocked vs dead
   ▼
[4] Enrich ────────────── abstract, OA location, citation count, source type
   │
   ▼
[5] Screen ────────────── heuristic filters, then optional model suggestions
   │
   ▼
[6] Extract ───────────── structured fields + quote spans
   │
   ▼
[7] Weigh ─────────────── stance, quality signals, recency, coverage
   │
   ▼
[8] Outline ───────────── grounded outline from the evidence table
   │
   ▼
[9] Draft ─────────────── model writes only from the evidence bundle
   │
   ▼
[10] Export ───────────── Markdown, JSON, CSV, BibTeX, CSL-JSON
   │
   ▼
[11] Audit ────────────── every query, source, decision and model call
```

Stages 1–4 are deterministic apart from optional query planning. Stages 5–9
may use a model. Stage 3 never does.

### 7.1 Honest failure

Each stage records a status: `ok`, `partial`, `skipped`, `failed`. A failed
provider does not fail the run. A failed verification marks the source
`unverified`, never `verified`. A failed model call falls back to the
deterministic rung where one exists, otherwise that stage is `skipped` and the
output says so.

## 8. Verification

Reuse `@michaelborck/cite-sight-core` rather than reimplementing it. Already
available there:

- Crossref, OpenAlex, Semantic Scholar, arXiv, Europe PMC and DataCite lookups
- DOI resolution and identity matching with a confidence score
- Abstract extraction (OpenAlex inverted index, S2, Crossref, Europe PMC)
- URL liveness checks that distinguish blocked and paywalled from dead
- Retraction and publication-update flags
- Duplicate detection
- BibTeX export of verified matches only
- SSRF protection and per-provider rate limiting

### 8.1 Verification states

| State | Meaning | May be cited in a draft? |
|---|---|---|
| `verified` | Registry match, DOI resolves, title/author/year agree | Yes |
| `likely_valid` | Strong registry match, DOI unresolved or absent | Yes, marked |
| `unverified` | Metadata only, no independent confirmation | No (listed, not cited) |
| `retracted` | Registry reports retraction | Yes, with a retraction warning |
| `dead` | No registry match and URL unreachable | No |

"Marked" means the export and draft include a machine-readable flag and the
human sees it. Winnow does not silently upgrade a weak record.

### 8.2 BibTeX and CSL-JSON

- BibTeX export includes only `verified`, `likely_valid` and `retracted`
  records.
- Cite keys follow the `surnameYEARtitleword` convention already used in
  `cite-sight`'s `bibtexExport.ts`, deduplicated with letter suffixes.
- Titles are double-braced to preserve casing.
- CSL-JSON is exported alongside BibTeX because Zotero, Pandoc and most
  reference managers consume it directly.
- No fabricated fields. If a field is unknown, it is omitted, not guessed.

### 8.3 Abstracts

- Abstracts come from the registry response. No paywalled scraping.
- If no abstract exists, the record is shown without one and marked
  `abstract_missing`.
- Open-access full text is fetched only when a licence permits and only in
  Extract/Review, never in Explore by default.

## 9. Model policy

The default is a local model through Ollama or any OpenAI-compatible endpoint
(llama.cpp, LM Studio, MLX). No API keys are bundled. Bring-your-own-key is
supported for people who want a frontier model for prose; keys live in the
environment or the OS keychain, never in the database or logs.

### 9.1 What the model may and may not do

| Task | Model? | Deterministic fallback |
|---|---|---|
| Query expansion | Yes, small model | Template terms + field synonyms |
| Deduplication | Never | DOI + fuzzy title matching |
| Verification | Never | Registry APIs |
| Screening suggestion | Yes, small/medium | Keyword, date, type filters |
| Field extraction | Yes, medium | Regex for DOI/year/venue; abstract slices |
| Stance suggestion | Yes, medium | Cue words, marked "candidate" |
| Outline | Yes, medium | Section template from the brief |
| Draft prose | Yes, medium/frontier | Template with evidence table excerpts |

Every model task must have a schema, temperature 0 where supported, a retry
policy, and output validation. Malformed output is rejected, not repaired
silently.

### 9.2 The evidence bundle

Before drafting, Winnow builds an evidence bundle: one record per usable claim,
containing the source ID, the quote, the location, the extraction fields, and
the stance. The drafting prompt receives only this bundle. It is instructed to:

- cite only source IDs present in the bundle;
- attach a quote to every claim;
- write "the retrieved sources do not address this" rather than fill a gap;
- never introduce a reference, statistic, or study not in the bundle.

After generation, a checker verifies that every citation ID exists in the
bundle and that every quoted span occurs in the source text. Sentences that
fail are dropped and the drop is logged. This is the enforceable version of
"No source, no sentence."

## 10. Data model

SQLite (via `better-sqlite3`), one database per project. Files (briefs,
exported drafts, optional PDFs) live beside it in the project folder.

| Entity | Key fields |
|---|---|
| `Project` | id, name, created_at, mode, settings_json |
| `Brief` | project_id, question, thesis, scope_json, include_json, exclude_json, raw_text |
| `Query` | id, project_id, run_id, text, origin (`model`/`heuristic`/`user`), polarity (`support`/`counter`) |
| `Source` | id, project_id, doi, title, authors_json, year, venue, abstract, oa_url, citation_count, type, retraction_status |
| `Identifier` | source_id, scheme (`doi`/`arxiv`/`pmid`/`isbn`/`url`), value |
| `Verification` | source_id, state, confidence, provider, checked_at, evidence_json |
| `Screening` | source_id, suggested, decision, reason, reviewer, decided_at |
| `Extraction` | source_id, field, value, quote, location, model, confidence |
| `Stance` | source_id, label, quote, rationale, suggested, confirmed |
| `Claim` | id, draft_id, text, source_ids_json, quotes_json, status (`kept`/`dropped`) |
| `Draft` | id, project_id, mode, markdown, created_at, model, brief_id |
| `Run` | id, project_id, started_at, finished_at, stages_json, component_health_json |
| `AuditEvent` | id, run_id, at, actor (`system`/`user`/`model`), action, payload_json |

No vector database in v1. Retrieval is API-driven and the corpus is small
(tens to low hundreds of sources). SQLite FTS5 handles local search. Embeddings
are a later, optional index, not a dependency.

## 11. CLI

```
winnow init <name>                     Create a project folder and database
winnow search <topic>                  Explore: retrieve, dedupe, verify, enrich
  --limit <n>                          Max sources (default 40)
  --since <year> --until <year>
  --type <article|preprint|book|...>
  --abstracts                          Include abstracts in output (default on)
  --counter                            Add counter-evidence pass
  --provider <openalex,crossref,...>   Restrict providers
  --format <table|json|csv|bibtex|csl>
  --out <file>
winnow verify <doi|file>               Verify a DOI or a reference file
winnow screen <project>                Suggest and record include/exclude
  --decisions <file>                   Apply human decisions from CSV/JSON
winnow extract <project> --fields ...  Structured extraction with quotes
winnow review <project>                Grounded review draft
  --brief <file>                       Optional question/thesis/scope brief
  --out <file>
winnow argue <project> --thesis "..."  Argument map and draft
winnow counter <project>               Counter-evidence pass
  --of <doi|source-id>                 Citation chasing from a target paper
  --topic "..."                        Inverted-query search
winnow export <project> --format ...   Export sources, evidence, or draft
winnow doctor                          Check providers, model, network, keys
```

Examples:

```bash
winnow init phd-lit-review
winnow search "retrieval augmented generation for systematic reviews" \
  --since 2020 --limit 60 --counter --format json --out sources.json

winnow review phd-lit-review --brief brief.md --out drafts/review-v1.md

winnow argue phd-lit-review \
  --thesis "RAG reduces citation fabrication in literature reviews" \
  --out drafts/argument.md
```

Exit codes: `0` success, `1` partial (some component failed), `2` invalid
input, `3` nothing found after verification. Partial success is never silent.

## 12. Outputs

- **Table** — terminal summary: year, first author, title, venue, state, citations.
- **JSON** — the full record, including verification evidence and audit IDs.
- **CSV** — evidence table, one row per source or per extracted claim.
- **Markdown** — review or argument draft with a reference list and an evidence appendix.
- **BibTeX / CSL-JSON** — verified references only.
- **PRISMA counts** — identified, deduplicated, screened, excluded (by reason), included.

Every draft ends with an evidence appendix mapping each citation to its quote
and source, so a reader can audit the prose without rerunning the tool.

## 13. Privacy and security

- No telemetry, analytics, accounts or cloud sync.
- The local server binds `127.0.0.1`, uses a per-session token, and checks
  origin for state-changing requests.
- Outbound network access is allowlisted to scholarly APIs and the configured
  search provider. No arbitrary URL fetching except the user's explicit link
  checks, which go through SSRF protection.
- API keys are read from the environment or OS keychain; they are never written
  to SQLite, logs or exports.
- Logs redact identifiers where they could reveal a research topic.
- Downloaded PDFs are treated as untrusted input: size limits, no macro
  execution, no automatic opening.
- `winnow doctor` reports exactly which hosts the tool will contact.

## 14. Architecture

TypeScript monorepo, mirroring `honeyguide`:

```
winnow/
├── packages/
│   ├── core/        pure library: retrieval, verification, evidence, drafting
│   ├── cli/         Commander.js
│   ├── server/      Express, localhost only, JSON contract
│   ├── web/         React + Vite
│   └── desktop/     Electron shell around the built web UI
├── docs/adr/
├── SPEC.md
└── package.json
```

- **core** has no UI or transport assumptions. It depends on
  `@michaelborck/cite-sight-core`.
- **cli** calls core directly. It never goes through the server.
- **server** exposes core over localhost JSON for the web and desktop clients.
- **web** and **desktop** are clients of that contract; neither owns business
  logic.
- TypeScript is chosen because the verification, abstract and BibTeX code
  already exists in TS, and one language spans every surface.

A Python sidecar is explicitly not used in v1. It earns its place only if PDF
parsing or local embeddings become a requirement, and then it is an isolated
service, not a second implementation of the pipeline.

## 15. Performance and reliability

- Explore of 100 candidates with verification: target under 90 seconds on a
  10 Mbps connection, excluding model calls.
- Progress streams to the terminal; runs are cancellable and resumable from a
  checkpoint.
- Per-provider concurrency and rate limits; exponential backoff on 429/5xx.
- All HTTP responses capped by size and time.
- A run is reproducible from its stored queries, provider set, parameters and
  model version.

## 16. Milestones

| Version | Scope |
|---|---|
| **v0.1** | Explore CLI: retrieve, dedupe, verify, abstracts, table/JSON/CSV/BibTeX/CSL export, audit log |
| **v0.2** | Briefs, screening with human decisions, extraction with quotes, PRISMA counts, checkpoint/resume |
| **v0.3** | Review and Argue drafting, evidence bundle, citation checker, counter-evidence pass |
| **v0.4** | Local web UI: browse, triage, read, edit drafts |
| **v0.5** | Desktop shell, installers, first-run model setup |
| **v1.0** | Hardening, docs, benchmark suite, release |

## 17. Acceptance criteria for v0.1

1. `winnow search "..." --limit 20` returns at least 15 deduplicated sources
   from two or more providers, or explains why not.
2. Every returned source has a verification state; no source is guessed.
3. DOI resolution failures are reported as failed, never retried into a pass.
4. Abstracts appear when the registry supplies them; missing abstracts are
   marked, not invented.
5. BibTeX export contains only verified or likely-valid records and parses in
   BibTeX and Pandoc.
6. CSL-JSON export imports into Zotero.
7. A failed provider produces a partial run with exit code 1 and a named
   component failure.
8. A run can be reproduced from its audit log alone.

## 18. Open questions

- **Citation contexts.** How complete are OpenAlex and Semantic Scholar
  citation contexts in practice, and what rate limits apply? Resolve before
  v0.3.
- **Open-access full text.** Which licence-clean sources (Unpaywall, Europe PMC,
  arXiv) are worth ingesting for extraction, and how do we avoid turning into a
  crawler?
- **Quality signals.** Venue ranking and citation counts encode bias. Decide
  what to show and what to explicitly not rank on. Default: show, do not score.
- **Grey literature.** Include web search in v0.1 or defer? Current plan:
  defer to v0.2 behind an explicit flag.
- **Languages.** English-first. Non-English abstracts are stored as returned;
  screening and drafting quality in other languages is out of scope for v1.
- **Zotero round-trip.** Import from Zotero is in scope; writing back is not.
  Revisit after v0.4.
- **Hypothesis interview.** The interactive "sharpen the question first" flow
  belongs in the web UI. Decide after watching CLI use.

## 19. Relationship to sibling projects

| Project | Contribution |
|---|---|
| `cite-sight` | Verification providers, abstract extraction, BibTeX export, SSRF protection, rate limiting |
| `honeyguide` | Retrieve → verify → enrich → rank pipeline, monorepo layout, CLI-first design, honest degradation, counterpoint via query inversion |
| `study-buddy` | Search-provider and LLM-provider abstractions, local-model setup UX |
| `cloned-repos/OpenNotebook` | UX reference only (notebooks, sources, chat); the local clone contains data, not source |

Winnow is not a fork of any of them. It depends on `cite-sight-core` and
borrows patterns, so improvements to verification benefit every tool.
