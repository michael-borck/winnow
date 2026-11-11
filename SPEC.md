# Winnow: Project Specification

**Status:** v1.1, incorporating the [2026-11-11 specification audit](docs/reviews/2026-11-11-spec-audit.md)
**Date:** 11 November 2026
**Supersedes:** v1.0 (`1fe5a81`)
**Repo:** `winnow`
**Binary:** `winnow`
**Packages:** `@michaelborck/winnow-core`, `@michaelborck/winnow-cli`
**Implementation:** v0.1 scaffold plus v0.2 brief parsing, screening and extraction — `init`, `brief`, `search`, `screen`, `extract`, `verify`, `replay`
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

Every source is verified against a scholarly registry. Every sentence in a
draft either carries a quoted span from a retrieved source, derives from a
deterministic corpus query, or is connective prose that makes no factual claim.
The model writes; it does not invent references.

### 1.1 Review scope

v1 supports **structured narrative reviews and scoping reviews** (ADR 0009). It does not
claim to produce a systematic review: a relevance-ranked result set is not an
exhaustive search, and PRISMA 2020 requires per-database search strings, counts
per database, a full-text eligibility stage and, in practice, dual independent
screening.

Winnow reports **PRISMA-inspired flow counts** (identified, deduplicated,
screened, excluded by reason, included). It says so in every export. An
exhaustive mode with uncapped retrieval, per-database counts and multi-reviewer
screening is deferred and tracked in §18.

## 2. The problem and prior art

The field already has good tools, and Winnow should name them rather than
pretend they do not exist:

- **Screening:** Rayyan, Covidence and ASReview screen records, and ASReview's
  active learning is well validated.
- **Extraction and synthesis:** Elicit extracts findings with supporting quotes;
  Consensus aggregates findings; scite labels citation stance as supporting or
  contrasting.
- **Libraries:** Zotero stores and annotates the PDFs.
- **Deep-research clones:** they write fluently from retrieved pages, and
  sometimes from what they remember.

What is missing is the combination: a local tool that retrieves from open
scholarly indexes, verifies identity deterministically, keeps suggestions
separate from decisions, finds counter-evidence with a quote behind every
label, and drafts only from a checked evidence bundle. That is Winnow's wedge:
local, deterministic verification, open, auditable.

## 3. Non-goals

- Not a reference manager. Winnow imports from and exports to Zotero-compatible
  formats; Zotero remains the library.
- Not an academic-integrity checker. That is `cite-sight`.
- Not a hosted multi-tenant SaaS. The local machine is the product.
- Not a plagiarism detector.
- Not a systematic-review engine in v1. See §1.1.
- Not an exhaustive search engine. Retrieval is bounded and reported.
- Not a full-text crawler. It works from metadata and abstracts, and optionally
  from open-access full text where a licence permits.
- Not a citation-style converter for every journal. APA 7 is bundled; other
  styles are accepted as CSL files.
- Not a generator of references. It only exports what passes the citability
  rule in §8.

## 4. Users and surfaces

| User | Primary need | Surface |
|---|---|---|
| Researcher / academic | Turn a question into a defensible narrative review | CLI, then local web |
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
2. **No source, no evidence sentence.** Every evidence claim carries a source ID
   and a quoted span; every synthesis claim cites two or more claims; every
   coverage claim comes from a deterministic corpus query; framing prose is
   linted and carries no facts. Provenance is enforced. Support is checked and
   flagged, never silently assumed.
3. **Local by default.** Data lives in a local SQLite file. Network access is
   limited to public scholarly APIs. A local model is the default; a frontier
   model is optional and never in the correctness path.
4. **Every judgement is labelled and reversible.** Screening, extraction,
   stance and support are suggestions until a human confirms. Suggestions and
   decisions are stored separately.
5. **Degrade honestly.** If a provider fails, the run continues and reports
   which component failed. Partial results are labelled, never padded.
6. **Replay is reproducible; re-execution is not.** Deterministic stages replay
   byte-identically from stored provider payloads. A live rerun is expected to
   drift, and produces a diff. Both are recorded.

## 6. Modes

Modes are composable stages, not project types. A run can stop after any stage
and resume later.

### 6.1 Explore

Input: a topic or question.
Output: a deduplicated, verified list of sources with title, authors, year,
venue, identifiers, abstract, open-access link, citation count, integrity
notices, link status, citability and source type.

This is the "list abstracts only" mode. No model is required.

### 6.2 Screen

Input: an existing reference file (BibTeX, RIS, CSV, JSON), or the output of
Explore.
Output: include / exclude / maybe decisions, a priority tier, exclusion reasons,
tags, and PRISMA-inspired flow counts.

The tool and the human do different jobs:

- **Suggestions** are stored in `ScreeningSuggestion`: suggested decision,
  suggested priority, confidence, rationale, method and model. They are
  regenerable and never overwrite a decision.
- **Decisions** are stored in `Screening`: append-only events with a reviewer,
  timestamp, decision, priority, reason code, free-text reason and tags.
  The current decision is the latest event. A human include always wins over a
  tool exclusion, and the conflict is reported.

Priority uses three tiers: `core`, `supporting`, `peripheral`. Exclusion reasons
use a controlled set (`off_topic`, `wrong_population`, `wrong_method`,
`not_empirical`, `duplicate`, `not_accessible`, `out_of_scope_date`,
`out_of_scope_venue`, `other`) plus free text.

Brief-level exclusions (`exclude_keywords`, `exclude_venues`,
`exclude_domains`, `exclude_types`) are **flags and counts** by default, not
silent removals. `--drop-excluded` hides flagged sources after the count has
been shown. Keyword matching uses word boundaries, never substrings.

### 6.3 Extract

Input: the current human-confirmed includes from Screen.
Output: a structured evidence table. Fields are configurable; the default set is
`population`, `method`, `sample`, `finding`, `limitation`, `quote`.

Only sources whose current screening decision is `include` are extracted.
Suggestions live in `ExtractionSuggestion` (field, value, quote, location,
confidence, method, model) and are regenerable. Human confirmations live in
`Extraction` as append-only rows with a reviewer and timestamp; the latest row
per source and field is the confirmed value.

Each value carries its source, a quote where available, and a location. A
suggestion never becomes a confirmed value without a human action.

### 6.4 Review

Input: a screened and extracted set, plus an optional brief.
Output: a literature review draft in Markdown, with formatted in-text citations
and a reference list. Sections follow the brief; the default is background →
themes → disagreements → gaps → conclusion.

The draft header states the model, its digest, the text basis ("abstracts only
for 38 of 42 sources"), and the counts of kept, marked, held and dropped
sentences.

### 6.5 Argue

Input: a thesis plus a screened set.
Output: an argument map and a draft that states the thesis, presents the
strongest evidence on each side, addresses the strongest counterargument, and
states what would change the conclusion.

The argument map uses the same four stance labels as the rest of the tool:

| Stance | Meaning in the map |
|---|---|
| `supports` | Evidence consistent with the thesis |
| `opposes` | Evidence inconsistent with the thesis |
| `mixed` | Conditional, partial or context-dependent evidence |
| `unclear` | Insufficient or ambiguous evidence |

The map is stored as structured JSON, not only prose. Each node records its
stance, the claim IDs behind it, the strongest quote, and one sentence on what
it adds. The map also records the strongest opposing node and the evidence that
would change the conclusion. If the strongest opposing node is weaker than the
supporting case, the draft says that rather than manufacturing balance.

The thesis is optional. Without it, Winnow runs Explore or Review. With it, the
tool groups sources by stance and drafts toward the argument. Interactive
questioning is a later web/TUI feature, not a v1 CLI requirement.

### 6.6 Counter-evidence

Counter-evidence is a facet available in Explore, Review and Argue, not a
separate product. It finds material that challenges a framing through three
grounded mechanisms:

1. **Query inversion.** Generate critical phrase queries from the topic or
   thesis. Phrases are quoted where the provider supports phrase search, because
   bag-of-words search treats "fails to" and "no evidence" as noise. Use a model
   when available; a term-expansion heuristic otherwise.
2. **Citation chasing.** Find papers that cite the target paper through
   Semantic Scholar, which supplies citation contexts. OpenAlex `cited_by` is a
   fallback without contexts. Because a highly cited paper can have thousands of
   citers, sample explicitly: recent citers, highly cited citers, and citers
   whose context contains critical cues. Record the sampling rule.
3. **Stance labelling.** Suggest `supports`, `opposes`, `mixed` or `unclear` for
   each abstract, with a required quote. This is a suggestion, labelled
   "candidate counter-evidence", and a human confirms it.

Counter-evidence runs through the identical verify-and-enrich path. The
one-third cap is a **retrieval budget**, not a cap on the reported result: it
limits how many counter-query results are fetched, while the stance
distribution is reported uncapped. A null result ("little credible opposition
found") is a valid output.

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
[2] Deduplicate ───────── DOI/identifier exact, then fuzzy title + author + year
   │
   ▼
[3] Verify ────────────── cite-sight-core: orthogonal axes, no model
   │
   ▼
[4] Enrich ────────────── abstract, OA location, citation count, source type
   │
   ▼
[5] Merge & rank ──────── reciprocal rank fusion, then deterministic selection
   │
   ▼
[6] Screen ────────────── heuristic filters, then optional model suggestions
   │
   ▼
[7] Extract ───────────── structured fields + quote spans
   │
   ▼
[8] Weigh ─────────────── study design, stance, quality features, coverage
   │
   ▼
[9] Outline ───────────── grounded outline from the evidence table
   │
   ▼
[10] Draft ────────────── model writes only from the evidence bundle
   │
   ▼
[11] Check ────────────── 5 deterministic checks + 1 support suggestion
   │
   ▼
[12] Export ───────────── Markdown, JSON, CSV, BibTeX, CSL-JSON
   │
   ▼
[13] Audit ────────────── every query, source, rank, decision and model call
```

Stages 1–5 and 11 (checks 1–5) are deterministic apart from optional query
planning. Stages 6–10 may use a model. Stages 3 and 5 never do.

### 7.1 Honest failure

Each stage records a status: `ok`, `partial`, `skipped`, `failed`. A failed
provider does not fail the run. A failed verification leaves the record
`pending`, never `verified`. A failed model call falls back to the deterministic
rung where one exists, otherwise that stage is `skipped` and the output says so.

### 7.2 Stage gates

Suggestions and decisions are separate. The default gate is human-confirmed:

| Stage | Default input | Relaxed input |
|---|---|---|
| Extract | Human-confirmed includes | `--allow-suggested` |
| Argue | Human-confirmed stances | `--allow-suggested` |
| Review | Human-confirmed extractions | `--allow-suggested` |

`--unattended` implies `--allow-suggested` and marks every output as using
unconfirmed suggestions. The draft header reports how many were used. Batch
mode is therefore possible, but honest.

### 7.3 Merge, rank and selection

Every retrieved record is stored with its provenance, whether or not it is
selected (ADR 0010).

1. **Merge** by identifier (DOI, PMID, arXiv, ISBN, normalised title). Keep one
   `Source` with many `Identifier` rows. Keep every provider's rank.
2. **Fuse** provider relevance lists with reciprocal rank fusion (k = 60). RRF
   avoids comparing incomparable provider scores.
3. **Filter** on machine-applicable criteria only: year, type, language,
   open-access status, provider exclusions.
4. **Select** the top N for screening. Deterministic tie-breakers, in order:
   check completeness, recency, citation percentile within year and field (if
   the provider supplies it), open-access availability. A counter-evidence
   retrieval budget is reserved here; the stance distribution is reported later
   without a cap.
5. **Record** every candidate in `RunSource` with provider ranks, RRF score,
   final rank and `selected`. `--limit` changes selection only; it never deletes
   the record of what was found.

Citation count is shown, not used as the primary relevance signal. Where a
field/year percentile is unavailable, the raw count and its collection date are
shown and the percentile is left null. No composite "quality score" is
computed.

### 7.4 Weigh

Weigh produces inspectable features, not a verdict:

| Output | Values / source |
|---|---|
| `study_design` | RCT, quasi-experimental, observational, systematic review, meta-analysis, qualitative, simulation, opinion, other, unknown |
| `source_type` | journal article, preprint, conference paper, book, chapter, report, standard, thesis, web |
| `peer_reviewed` | yes / no / unknown |
| `citation_count` | value + provider + collection date |
| `citation_percentile` | field/year percentile when available, else null |
| `oa_status` | open / closed / unknown |
| `quality_flags` | retracted, correction, small sample (only if stated), industry funded (only if stated), preprint |
| `stance` | supports / opposes / mixed / unclear, with target brief |
| `coverage` | counts by design, stance, year and source type |

`study_design` is a suggestion until confirmed. It is never used silently to
exclude a source. Quality flags are shown, not scored.

## 8. Verification

Reuse `@michaelborck/cite-sight-core` rather than reimplementing it. It supplies
Crossref, OpenAlex, Semantic Scholar, arXiv, Europe PMC and DataCite lookups,
DOI resolution, identity matching, abstract extraction, URL checks, retraction
notices, duplicates, SSRF protection and rate limiting.

Pin the dependency to the exact tested version (`0.13.3`) in `package.json`.
The npm registry contains a stale `1.0.0` from the first publish, so a caret
range would silently resolve to it. Wrap the dependency in
`core/src/verification/cite-sight-adapter.ts` and test the expected interface,
so an upstream change fails a test rather than a run.

### 8.1 Verification model

A source's verification record has five independent axes (ADR 0007). No axis is
derived from a model. Winnow stores every axis exactly as `cite-sight-core`
reports it and never merges them into a single state.

| Axis | Values | Source |
|---|---|---|
| Identity | `verified`, `likely_valid`, `unverified`, `not_found`, `suspicious`, `format_only`, `user_attested` | `VerificationStatus`; `user_attested` is Winnow's own |
| Match category | `exact`, `variant_record`, `metadata_drift`, `match_dubious`, `conflict`, `not_indexed_expected`, `none` | `MatchCategory` |
| Integrity notices | `none_found`, `retracted`, `expression_of_concern`, `correction`, `withdrawn` | `PublicationCheck.updates` |
| Link status | `live`, `dead`, `blocked`, `redirect`, `timeout`, `error`, `no_url` | `UrlStatus` |
| Check completeness | `complete`, `incomplete` with the unavailable service and reason | `unavailable` |

`none_found` means only that no registry reported a notice. It does not certify
that the work was never retracted, and the UI must say so.

Link status is informational. A dead link alone never changes whether a source
can be cited, because publishers often block automated checks.

#### 8.1.1 Citability rule

Winnow derives citability with one deterministic function, `citability(record)`.
The draft checker, the BibTeX exporter and the CSL-JSON exporter all call this
same function. Order matters:

1. If check completeness is `incomplete` → `pending`.
2. If identity is `not_found`, `suspicious` or `format_only` → `not_citable`.
3. If match category is `match_dubious` or `conflict` → `not_citable`.
4. If identity is `verified`, `likely_valid` or `user_attested`, and an
   integrity notice is `retracted`, `withdrawn` or `expression_of_concern` →
   `citable_warned`.
5. If identity is `user_attested` → `citable_attested`.
6. If identity is `verified` and match is `exact` or `variant_record` →
   `citable`.
7. If identity is `likely_valid`, or match is `metadata_drift` →
   `citable_marked`.
8. Otherwise → `not_citable`.

| Result | Behaviour |
|---|---|
| `citable` | Cited normally |
| `citable_marked` | Cited with a visible marker and a machine-readable flag |
| `citable_attested` | Cited with an "attested by \<reviewer>" flag |
| `citable_warned` | Cited only with the integrity notice stated inline |
| `pending` | Not citable until rechecked; never silently promoted |
| `not_citable` | Listed in Explore output, excluded from drafts and exports |

Two invariants hold for every record:

1. No model output can change any axis or the citability result.
2. `user_attested` requires a named reviewer and a timestamp, stored as an
   `AuditEvent`. It can be applied only to identity `unverified` or
   `not_found`, never to `suspicious`.

#### 8.1.2 Circularity

Explore retrieves from the same registries it verifies against. For
registry-native hits, verification adds cross-registry agreement and a DOI
resolution check, not independent discovery. The UI says "found in OpenAlex,
DOI resolves, also indexed in Crossref", not "verified". Verification adds its
full value for imported reference files, grey literature and user-supplied
citations.

#### 8.1.3 Variant records

When the match category is `variant_record`, as with a preprint and its
published version, Winnow links the two as versions of one work. It does not
delete either. The version of record is canonical for citation, both identifiers
are kept, and citation counts are shown per version with their provider. Counts
are never summed silently.

#### 8.1.4 Export

BibTeX and CSL-JSON export every record whose citability starts with
`citable_`. Flags are written to the CSL `note` and a BibTeX `note` field, for
example `winnow: likely_valid; retracted 2024`. `pending` and `not_citable`
records are exported only to JSON and CSV, never to citation formats.

Cite keys follow the `surnameYEARtitleword` convention used by
`cite-sight`'s `bibtexExport.ts`, deduplicated with letter suffixes. Titles are
double-braced. No field is guessed: an unknown field is omitted.

### 8.2 Source text and abstracts

- Text is stored in `SourceText` with the exact metadata and licence, so the
  quote checker has a fixed version to check against.
- `SourceText` stores both the original text and a normalised text with its
  SHA-256. Normalisation is defined in §9.4.
- Abstracts come from the registry response. No paywalled scraping.
- If no abstract exists, the record is shown without one and marked
  `abstract_missing`. The draft header reports how many sources were abstract-only.
- Open-access full text is fetched only when a licence permits and only in
  Extract/Review, never in Explore by default.
- Grey literature uses `not_indexed_expected` plus an ISBN route where
  available, or `user_attested` with a named reviewer.

## 9. Model policy

The default is a local model through Ollama or any OpenAI-compatible endpoint
(llama.cpp, LM Studio, MLX). No API keys are bundled. Bring-your-own-key is
supported for people who want a frontier model for prose; keys live in the
environment or the OS keychain, never in the database or logs.

Local model artifacts are verified on load: a manifest pins the weight digest,
quantization and source revision. Ollama tags are mutable, so a tag alone is
not provenance. A digest change is reported and the run records which artifact
was used.

### 9.1 What the model may and may not do

| Task | Model? | Deterministic fallback |
|---|---|---|
| Query expansion | Yes, small | Template terms + field synonyms |
| Query inversion | Yes, small | Critical-term phrases |
| Deduplication | Never | Identifier + fuzzy title matching |
| Verification | Never | Registry APIs |
| Ranking | Never | RRF + documented tie-breakers |
| Screening suggestion | Yes, small/medium | Keyword, date, type filters |
| Field extraction | Yes, medium | Regex for DOI/year/venue; abstract slices |
| Stance suggestion | Yes, medium | Cue words, marked "candidate" |
| Study-design suggestion | Yes, medium | Title/abstract regex, marked "unknown" |
| Outline | Yes, medium | Section template from the brief |
| Draft prose | Yes, medium/frontier | Template with evidence excerpts |
| Support check | Yes, separate model | None; the field is left unset |

Every model task has a schema, temperature 0 where supported, a fixed seed
where supported, a retry policy and output validation. Malformed output is
rejected, not repaired silently. Deterministic fallbacks are marked as degraded
in the run report.

### 9.2 The evidence bundle

Before drafting, Winnow builds an evidence bundle. The drafting prompt receives
only this bundle and the brief. Each record holds:

- `claim_id`, `source_id`, and `source_text_sha256`, pinning the exact abstract
  or full-text version used;
- the quote and its character span in the normalised source text;
- the extraction fields, each with its suggested or confirmed flag;
- the stance, with its target brief and suggested or confirmed flag;
- the citability result from §8.1.1.

Only `citable_*` sources enter the bundle. Unconfirmed suggestions may enter
only under the gate policy in §7.2, and they stay marked. The draft header
reports how many unconfirmed suggestions were used.

The guarantee is stated precisely:

> Every cited source passed verification, and every quoted span occurs verbatim
> in the stored source text. Winnow does not guarantee that each sentence
> faithfully represents its quote. It flags likely misrepresentation for human
> review.

### 9.3 Sentence types

The drafting model must tag every output sentence (ADR 0008). An untagged
sentence is treated as `evidence`.

| Type | Example | Grounding required |
|---|---|---|
| `evidence` | "Smith et al. found a 12% reduction in fabricated citations." | One or more bundle claim IDs, each with its quote |
| `synthesis` | "Studies disagree on whether retrieval quality matters more than model size." | Two or more claim IDs; for a comparison, at least one per side |
| `coverage` | "None of the 42 included sources report non-English evaluations." | A named coverage query computed over the corpus |
| `framing` | "Three themes emerge from the literature." | No claim IDs; linted, see §9.4 |

Gap claims are `coverage` sentences. Their numbers come from a deterministic
query, never from the model.

### 9.4 Checks

Checks run in this order. Checks 1–5 are deterministic; check 6 is a labelled
suggestion.

1. **Schema.** The output parses, and every sentence has a type and the
   required fields.
2. **IDs.** Every cited ID is in the bundle and is `citable_*`. A
   `citable_warned` ID has its integrity notice stated in the same sentence.
3. **Quotes.** Each normalised quote occurs exactly at its declared span in the
   normalised source text. Normalisation means NFKC, collapsed whitespace,
   line-break hyphens joined, JATS and HTML tags stripped, and curly quotes
   folded to straight. No fuzzy matching.
4. **Numbers.** Every number in an `evidence` or `synthesis` sentence appears in
   one of its quotes. Every number in a `coverage` sentence equals the
   recomputed value. `framing` sentences contain no numbers, study names or
   citations.
5. **Synthesis shape.** A `synthesis` sentence that states disagreement cites
   claims with differing confirmed or suggested stances.
6. **Support.** A separate model checks whether the quoted spans entail the
   sentence. It returns `supported`, `partial`, `unsupported` or `contradicted`.
   Where possible it is a different model from the drafting model. The result
   is stored as a suggestion with the model name and prompt version. It is not
   a gate, and it has no pass threshold in v0.3.

### 9.5 Outcomes

Every outcome is logged, and every non-dropped outcome is reversible by a human.
`Claim.status` values are `kept`, `kept_marked`, `held` and `dropped`.

| Check result | Claim status | In the rendered draft? |
|---|---|---|
| Checks 1–5 fail | `dropped` | No; listed in the evidence appendix with the reason |
| Support is `contradicted` or `unsupported` | `held` | No; shown in a review queue, restorable by a human |
| Support is `partial` | `kept_marked` | Yes, with a visible marker |
| All checks pass | `kept` | Yes |

A human edit re-runs checks 1–5 on the edited sentences. Check 6 runs on
request.

The draft header states the drafting model and digest, the text basis, and the
counts of kept, marked, held and dropped sentences. The evidence appendix maps
every citation to its quote and source.

### 9.6 Citation rendering

Drafts use author-year in-text citations and a reference list rendered by
`citeproc-js` from the project's CSL-JSON. APA 7 is bundled. `--style
<file.csl>` accepts another style. Internally, claims cite source IDs; the
renderer maps IDs to formatted citations. If rendering fails, the draft still
renders with visible IDs and the failure is reported.

## 10. Data model

SQLite (via Node's built-in `node:sqlite`), one database per project. Files
(briefs, payloads, exports, drafts, optional PDFs) live beside it in the project
folder. The `SchemaVersion` table records the schema version, with a forward-only
migration policy: a newer database refuses to open in an older binary.

| Entity | Key fields |
|---|---|
| `Project` | id, name, path, created_at, settings_json, `default_stage` |
| `SchemaVersion` | version, applied_at |
| `Brief` | id, project_id, question, thesis, `mode`, scope_json, `filters_json`, `criteria_json`, counter, raw_text, created_at |
| `Query` | id, project_id, run_id, text, origin (`model`/`heuristic`/`user`), polarity (`support`/`counter`) |
| `Source` | id, project_id, title, authors_json, year, venue, type, citation_count, citation_provider, citation_collected_at |
| `Identifier` | source_id, scheme (`doi`/`arxiv`/`pmid`/`isbn`/`url`), value, unique(scheme, value) |
| `RawPayload` | id, run_id, provider, url, fetched_at, sha256, compression, path, size |
| `RunSource` | run_id, source_id, query_id, provider, provider_rank, rrf_score, rank, selected, raw_payload_id |
| `Verification` | source_id, identity, match_category, integrity_json, link_status, completeness, confidence, provider, checked_at, evidence_json |
| `SourceText` | source_id, kind (`abstract`/`fulltext`), text, normalised_text, sha256, licence, fetched_at |
| `Screening` | id, run_id, source_id, decision (`include`/`exclude`/`maybe`), relevance (`core`/`supporting`/`peripheral`), reason_code, reason, tags_json, reviewer, decided_at (append-only) |
| `ScreeningSuggestion` | id, run_id, source_id, suggested_decision, suggested_relevance, confidence, rationale, method, model, created_at |
| `Extraction` | id, run_id, source_id, field, value, quote, location, reviewer, confirmed_at (append-only; latest per source+field wins) |
| `ExtractionSuggestion` | id, run_id, source_id, field, value, quote, location, confidence, method, model, created_at |
| `Stance` | id, source_id, `target_brief_id`, label, quote, rationale, suggested, confirmed, confirmed_by |
| `Weigh` | source_id, study_design, quality_flags_json, citation_percentile, computed_at |
| `Claim` | id, draft_id, sentence_index, text, sentence_type, source_ids_json, quotes_json, status (`kept`/`kept_marked`/`held`/`dropped`), check_json |
| `Draft` | id, project_id, mode, markdown, created_at, model, model_digest, prompt_version, brief_id, parent_id, edited_by, basis_json |
| `ArgumentMap` | id, project_id, brief_id, nodes_json, created_at |
| `ModelArtifact` | name, digest, quantization, source, verified_at |
| `Consent` | project_id, provider, granted_by, granted_at, payload_preview_sha256, revoked_at |
| `Run` | id, project_id, started_at, finished_at, stages_json, component_health_json, config_json, model_digest |
| `AuditEvent` | id, run_id, at, actor (`system`/`user`/`model`), action, payload_json |

Notes:

- `doi` lives only in `Identifier`. A view provides a convenience `doi` column.
- Screening is append-only; "reversible" means a new row, not a lost decision.
- Screening suggestions live in `ScreeningSuggestion`; a decision never depends
  on a suggestion row staying current.
- Brief exclusion filters are applied at screening as flags and counts.
  `--drop-excluded` hides flagged sources but keeps the count and the decision
  history.
- Drafts carry lineage through `parent_id`; a save re-runs checks 1–5.
- `Stance` is relative to a brief. Changing the thesis creates a new brief and
  invalidates old stances rather than silently reusing them.
- `RawPayload` stores compressed provider responses so replay is possible. The
  default cap is 2 MB per payload and 250 MB per project.
- No vector database in v1. Retrieval is API-driven and the corpus is small
  (tens to low hundreds of sources). SQLite FTS5 handles local search.

## 11. CLI

```
winnow init <name> [--path <dir>]       Create a project folder and database
winnow search <topic>                   Explore: retrieve, dedupe, verify, rank
  --project <name|path>                 Nearest .winnow project if omitted
  --limit <n>                           Max selected sources (default 40)
  --since <year> --until <year>
  --type <article|preprint|book|...>
  --no-abstracts                        Omit abstracts from terminal output
  --counter                             Add counter-evidence pass
  --provider <openalex,crossref,...>    Restrict providers
  --format <table|json|csv|bibtex|csl>
  --out <file>
  --no-save                             Run without writing to a project
winnow verify <doi|file>                Verify a DOI or a reference file
winnow screen [project]                 Human decisions for a run
  --run <run-id>                        Default: latest completed run
  --brief <file>                        Brief with exclusion filters
  --all                                 Include unselected sources
  --suggest                             Store heuristic tool suggestions
  --interactive                         Quick terminal triage
  --decisions <file>                    Apply human decisions from CSV/JSON
  --drop-excluded                       Hide sources flagged by brief filters
  --reviewer <name>                     Reviewer for new decisions
  --format <table|json|csv>             Default: table
  --out <file>
winnow extract [project]                Human-confirmed evidence table
  --run <run-id>                        Default: latest completed run
  --fields <list>                       Default: population,method,sample,finding,limitation,quote
  --suggest                             Store heuristic field suggestions
  --interactive                         Confirm or edit fields one at a time
  --decisions <file>                    Import confirmed values from CSV/JSON
  --reviewer <name>                     Reviewer for confirmed values
  --format <table|json|csv>             Default: table
  --out <file>
winnow review <project>                 Grounded review draft
  --brief <file>                        Question/thesis/scope brief
  --out <file>
  --style <file.csl>                    Default: bundled APA 7
  --allow-suggested                     Use unconfirmed extractions (marked)
winnow argue <project>                  Argument map and draft
  --thesis "..."                        Thesis for this run
  --brief <file>                        Or take the thesis from a brief
  --out <file>
  --allow-suggested                     Use unconfirmed stances (marked)
winnow counter <project>                Counter-evidence pass
  --of <doi|source-id>                  Citation chasing from a target paper
  --topic "..."                         Inverted-query search
winnow replay <run-id> [--project <p>]  Re-derive deterministic stages from payloads
winnow rerun <run-id> --live [--diff] [--project <p>]
                                        Re-execute live and report drift
winnow export <project> --format ...    Sources, evidence or draft
winnow project export <project> --out <archive.tar.gz>
winnow project delete <project> --purge [--yes]
winnow cache purge                      Delete stored payloads and caches
winnow doctor                           Check providers, model, network, keys
```

A project is a directory containing `.winnow/project.json` and
`project.sqlite`. `winnow init <name>` creates `./<name>/`; `--path` chooses a
different parent. Commands resolve `--project` as a name or path, otherwise walk
up from the current directory to the nearest `.winnow` folder. `winnow search`
without a project runs ephemerally and says so.

Brief files separate machine filters from judged criteria:

```yaml
---
mode: review
question: Does RAG reduce citation fabrication in literature reviews?
thesis: RAG reduces fabrication when retrieval is verified.
scope:
  date_range: 2018..2026
  disciplines: [computer science]
filters:
  types: [journal-article, conference-paper, preprint]
  languages: [en]
  exclude_keywords: [press release, pilot study]
  exclude_venues: [Predatory Journal]
  exclude_domains: [example.com]
  exclude_types: [editorial]
criteria:
  include: [studies measuring citation accuracy, preprints with code]
  exclude: [opinion pieces]
counter: true
---
Free-text context.
```

`filters` are applied by code. `criteria` are judged by a human, with optional
model suggestions. A brief may set `mode: review` or `mode: argue`;
`winnow review --brief` dispatches on it, and `winnow argue` is the explicit
form for argument mode.

Examples:

```bash
winnow init phd-lit-review
cd phd-lit-review
winnow search "retrieval augmented generation for literature reviews" \
  --since 2020 --limit 60 --counter --format json --out exports/sources.json

winnow screen . --interactive
winnow screen . --suggest --format csv --out exports/decisions.csv
winnow extract . --fields method,sample,finding
winnow review . --brief briefs/question.md --out drafts/review-v1.md

winnow argue . --thesis "RAG reduces citation fabrication in literature reviews" \
  --out drafts/argument.md

winnow replay run-2026-11-11-001
winnow project export . --out ../winnow-review-backup.tar.gz
```

### 11.1 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Completed, but at least one provider or stage failed (partial) |
| 2 | Invalid input or usage |
| 3 | Completed with zero citable sources, and no component failed |

Precedence: 2, then 1, then 3, then 0. If a provider failed and the result is
empty, exit 1 is returned and the empty result is reported as a consequence.
Partial success is never silent.

## 12. Outputs

- **Table** — year, first author, title, venue, identity, match category,
  citability, citation count.
- **JSON** — the full record, including all verification axes and audit IDs.
- **CSV** — evidence table, one row per source or per extracted claim.
- **Markdown** — review or argument draft with formatted citations, a reference
  list and an evidence appendix.
- **BibTeX / CSL-JSON** — `citable_*` records only, with flags in `note`.
- **Review flow counts** — identified, deduplicated, screened, excluded (by
  reason), included. Labelled "PRISMA-inspired", never "PRISMA-compliant".
- **Run report** — provider request counts, failures, ranks, model artifacts,
  gate policy and drift.
- **Screening export** — source ID, DOI, decision, relevance, reason code,
  reason, tags, reviewer, filter flags and tool suggestion. CSV and JSON both
  round-trip; blank decision rows are ignored on import.
- **Evidence export** — one row per source and field, with confirmed value,
  quote, location, reviewer, confirmation time and separate suggestion fields.
  CSV and JSON round-trip confirmed values only; suggestions are never imported
  as confirmations.

Every draft ends with an evidence appendix mapping each citation to its quote
and source, so a reader can audit the prose without rerunning the tool.

## 13. Privacy and security

### 13.1 Threat model

"Privacy-first" means local by default and explicit about what leaves the
machine.

| Observer | What they can see | Mitigation |
|---|---|---|
| Scholarly APIs (OpenAlex, Crossref, S2, …) | Query terms, IP address, and an email if polite-pool is enabled | Query minimisation; email only if the user sets one; never send thesis text |
| Optional web search (SearXNG, Brave) | Query terms | Self-hosted SearXNG default; disabled unless the user enables grey literature |
| Cloud LLM (BYOK) | Brief, evidence bundle, prompts | Per-project consent with a payload preview; local model is the default; no automatic fallback to cloud |
| Other local users | SQLite, payloads, drafts, keys if stored carelessly | OS file permissions; keys in keychain; `project delete --purge` |
| Logs and exports | Derived text | Strict log rule below; exports are user-controlled |
| Model supply chain | Downloaded weights | Manifest with digest, quantization and revision; verify on load |

### 13.2 Rules

- No telemetry, analytics, accounts or cloud sync.
- The local server binds `127.0.0.1`, uses a per-session token, and checks
  origin for state-changing requests.
- Outbound network access is allowlisted to scholarly APIs and the configured
  search provider. No arbitrary URL fetching except explicit link checks, which
  go through SSRF protection.
- Query minimisation: send keywords and identifiers, not the full brief or
  thesis. A cloud call requires a preview of the exact payload.
- API keys are read from the environment or OS keychain; they are never written
  to SQLite, logs or exports.
- Application logs contain event types, counts, durations, provider names and
  error codes. They do not contain query text, titles, abstracts, briefs or
  drafts. The project database stores queries and results by design; it is local
  and covered by the purge rule. `--debug` may include query text only with a
  warning, in a separate file that `winnow cache purge` removes.
- Retrieved abstracts and full text are untrusted input. They are delimited as
  data, never treated as instructions, and cannot change the system prompt,
  tool permissions or citability. Retrieved text never triggers a tool call.
- Downloaded PDFs are treated as untrusted input: size limits, no macro
  execution, no automatic opening.
- `winnow doctor` reports exactly which hosts the tool will contact.
- `winnow project delete --purge` removes the database, payloads, source text
  and managed drafts after confirmation. `winnow project export` produces a
  portable archive first.

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
├── docs/reviews/
├── SPEC.md
└── package.json
```

- **core** has no UI or transport assumptions. It depends on the pinned
  `@michaelborck/cite-sight-core` behind an adapter.
- **cli** calls core directly. It never goes through the server.
- **server** exposes core over localhost JSON for the web and desktop clients.
- **web** and **desktop** are clients of that contract; neither owns business
  logic.
- TypeScript is chosen because the verification, abstract and BibTeX code
  already exists in TS, and one language spans every surface.
- `citeproc-js` renders citations. `node:sqlite` is built in; if Electron's
  bundled Node does not expose it, the desktop package falls back to
  `better-sqlite3` and rebuilds it per Electron version.
- Node 24+ is required for the built-in `node:sqlite` used by the CLI and
  server.

A Python sidecar is explicitly not used in v1. It earns its place only if PDF
parsing or local embeddings become a requirement, and then it is an isolated
service, not a second implementation of the pipeline.

## 15. Performance and reliability

- Explore of 100 candidates: budget ≤ 6 support searches plus the documented
  counter budget, ≤ 100 enrichment calls and ≤ 100 URL checks, with concurrency
  ≤ 4 per provider. Target p95 under two minutes excluding model calls, subject
  to provider limits.
- The real bottleneck is rate limiting and bot-blocking on URL checks, not
  bandwidth. The run report records the request count per host.
- Progress streams to the terminal; runs are cancellable and resumable from a
  checkpoint.
- Per-provider backoff on 429/5xx; all HTTP responses capped by size and time.
- Provider payloads are stored compressed for replay, within the caps in §10.
- A run is reproducible in two senses: **replay** re-derives deterministic
  stages byte-identically from stored payloads; **re-execution** runs live and
  reports drift (ADR 0011).

## 16. Milestones

| Version | Scope |
|---|---|
| **v0.1** | Explore CLI: retrieval, dedupe, orthogonal verification, citability, merge/rank/select, abstracts, payload storage, replay, table/JSON/CSV/BibTeX/CSL export, audit log |
| **v0.2** | Briefs, interactive and CSV screening, extraction, stage gates, PRISMA-inspired counts, screening evaluation, checkpoint/resume |
| **v0.3** | Review and Argue, evidence bundle, sentence types, checks 1–6, support triage, counter-evidence pass, citation rendering, drafting evaluation |
| **v0.4** | Local web UI: browse, triage, read, edit drafts, review queue |
| **v0.5** | Desktop shell, installers, first-run model setup, native-module rebuild |
| **v1.0** | Hardening, docs, reproducibility report, release |

Evaluation is built with each feature, not at v1.0. Screening is measured
against SYNERGY and published reviews; counter-evidence recall against included
studies in published systematic reviews; verification and export against a
planted-fabrication set.

## 17. Acceptance criteria

### 17.1 v0.1

1. `winnow search "..." --limit 20` returns at least 15 deduplicated sources
   from two or more providers, or explains why not.
2. Every returned source has all five verification axes; no merged state exists
   in storage. Citability is derived by one shared function.
3. DOI resolution failures leave the record `pending` or `not_citable`, never
   `verified`.
4. Abstracts are stored in `SourceText` with a SHA-256 and normalised text.
   Missing abstracts are marked, not invented.
5. BibTeX contains only `citable_*` records and parses in BibTeX and Pandoc.
6. CSL-JSON contains only `citable_*` records and imports into Zotero.
7. A failed provider produces a partial run with exit code 1 and a named
   component failure. If a provider failed and the result is empty, exit is 1,
   not 3.
8. `winnow replay <run-id>` re-derives byte-identical deterministic outputs from
   stored payloads. `winnow rerun <run-id> --live` produces a drift report.
9. Every retrieved candidate is stored in `RunSource` with provider rank, RRF
   score, final rank and `selected`, whether or not `--limit` selected it.
10. A test asserts that no verification or ranking code path calls a model.

### 17.2 v0.2

1. A screening decision is append-only. Changing a decision adds a row; the
   latest row is the current state.
2. Suggestions are stored separately from decisions. A human decision can
   override a suggestion without deleting or rewriting it.
3. Brief exclusions flag and count; `--drop-excluded` hides flagged sources
   only after the count is reported.
4. CSV export/import round-trips decisions, and blank decision rows are skipped.
5. Counts include identified, deduplicated, screened, included, excluded,
   maybe, undecided and filtered out.
6. Extraction includes only sources whose current screening decision is
   `include`.
7. Extraction suggestions are stored separately. Confirmations are append-only,
   and the latest confirmation per source and field wins.
8. Evidence CSV/JSON round-trips confirmed values; suggestions are exported in
   separate columns and are never imported as confirmations.
9. The evidence summary reports included, extracted, complete and missing
   counts.

### 17.3 v0.3

1. On a planted-error set, checks 1–5 catch 100% of fabricated IDs, altered
   quotes, inflated numbers and wrong coverage counts.
2. On a labelled claim–quote set, the support checker's precision and recall for
   `unsupported` are measured and published with each release. There is no pass
   threshold in v0.3.
3. A draft with an empty review queue and zero dropped sentences is rendered
   identically by `winnow replay`.

## 18. Open questions

- **Citation contexts.** Semantic Scholar supplies contexts; OpenAlex does not.
  Measure coverage and rate limits before v0.3, and record the sampling rule for
  highly cited papers.
- **Open-access full text.** Which licence-clean sources (Unpaywall, Europe PMC,
  arXiv) are worth ingesting for extraction, and how do we avoid becoming a
  crawler?
- **Citation percentiles.** Which providers expose field/year percentiles
  reliably enough to rank on? Until then, show the raw count and date, and leave
  the percentile null.
- **Grey literature.** ISBN verification and `user_attested` are specified;
  decide whether web search enters v0.2 or waits.
- **Languages.** English-first. Non-English abstracts are stored as returned;
  screening and drafting quality in other languages is out of scope for v1.
- **Zotero round-trip.** Import is in scope; writing back is not. Revisit after
  v0.4.
- **Hypothesis interview.** The interactive "sharpen the question first" flow
  belongs in the web UI. Decide after watching CLI use.
- **Exhaustive mode.** Uncapped retrieval, per-database search strings and
  counts, full-text eligibility and multi-reviewer screening. This is the path
  to a systematic review, and it is not v1.
- **Encryption at rest.** SQLCipher or an OS-level encrypted volume. Decide
  before the desktop release.
- **CSL coverage.** APA 7 is bundled. Decide whether to ship a small style pack
  or rely on user-supplied CSL files.

## 19. Relationship to sibling projects

| Project | Contribution |
|---|---|
| `cite-sight` | Orthogonal verification model, providers, abstract extraction, BibTeX export, SSRF protection, rate limiting. Pinned to `0.13.3` |
| `honeyguide` | Retrieve → verify → enrich → rank pipeline, monorepo layout, CLI-first design, honest degradation, counterpoint via query inversion |
| `study-buddy` | Search-provider and LLM-provider abstractions, local-model setup UX |
| `cloned-repos/OpenNotebook` | UX reference only (notebooks, sources, chat); the local clone contains data, not source |

Winnow is not a fork of any of them. It pins `cite-sight-core` exactly and
borrows patterns, so improvements to verification benefit every tool. The
adapter contract is tested so upstream changes surface as failures, not silent
behaviour changes.

## 20. Revision history

| Version | Date | Change |
|---|---|---|
| v1.0 | 2026-11-11 | Initial specification (`1fe5a81`) |
| v1.1 | 2026-11-11 | Audit incorporated: orthogonal verification and citability, sentence taxonomy and post-generation checks, narrative/scoping scope, merge/rank/selection and Weigh, payload storage and replay, expanded data model, privacy threat model, inconsistency fixes |
| v0.1 scaffold | 2026-11-11 | `packages/core` and `packages/cli`: project schema, OpenAlex and Crossref retrieval, cite-sight adapter, citability, RRF ranking, exports, payload-integrity replay; `node:sqlite` |
| v0.2 (partial) | 2026-11-11 | CI workflow, YAML brief parser, append-only human screening with separate suggestions, priority tiers, exclusion flags, CSV/JSON round-trip, and human-confirmed extraction with separate suggestions |
