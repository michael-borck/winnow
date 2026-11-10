# Winnow Specification Audit

> **Status:** external spec audit; recommendations incorporated into SPEC v1.1.
> **Audited commit:** `1fe5a81`
> **Dependency checked:** `@michaelborck/cite-sight-core@0.13.3`
> **Prepared by:** external LLM reviewer
> **Reviewed by:** Michael Borck
> **Saved:** 11 November 2026

Nov 11, 2026 · @Michael Borck

## Summary

The spec is sound in its core ideas, but it overclaims in four places that should be fixed before any code is written. This audit covers README.md, SPEC.md and ADRs 0001–0006 at commit `1fe5a81` of [michael-borck/winnow](https://github.com/michael-borck/winnow). It also covers the published `@michaelborck/cite-sight-core@0.13.3` package, which the spec depends on.

The core design choices are right: verification is code, suggestions are kept apart from decisions, failure is reported honestly, and generated text is checked after the fact. The four weaknesses are:

- The citation checker proves provenance, not support, yet the spec says it guarantees support.
- "Weigh", the stage that gives the tool its name, is the least specified stage.
- The five verification states flatten a richer model that cite-sight-core already exports.
- The spec blurs narrative and systematic reviews.

Appendices A and B give drop-in replacement text for §8.1 and §9.2.

## What's strong

The spec is unusually disciplined for an AI research tool. These choices should survive any revision:

- **Testable principles.** The six principles in §5 are concrete enough to audit against, unlike most "design principles" sections.
- **Counter-evidence framing.** ADR 0004 treats counter-evidence as retrieval first and labelling second. It also accepts a null result as a valid output.
- **Clear non-goals.** Winnow positions itself alongside Zotero rather than competing with it.
- **CLI-first architecture.** A shared JSON contract means no UI may hold logic the CLI lacks, which keeps the architecture honest.
- **Model-policy table.** §9.1 gives every stage its model permission and a fallback. Malformed output is rejected, not silently repaired.
- **Honest stage status.** Each stage reports `ok`, `partial`, `skipped` or `failed`. A failed verification can never become `verified`.
- **Right-sized storage.** ADR 0006 uses SQLite with FTS5 and no vector database, which suits a corpus of tens to hundreds of sources.
- **Testable acceptance criteria.** Most v0.1 criteria can be checked directly.

## Major findings

### 1. The checker proves a quote exists, not that it supports the claim

§9.2 checks two things: citation IDs exist in the bundle, and quoted spans occur in the source. That blocks fabricated sources and fabricated quotes. It does not block a real quote attached to an overstated or reversed claim, for example "a modest improvement in a small pilot" cited under "substantially reduces".

As a result, §5.2's promise that "unsupported sentences are removed" cannot be enforced. The guarantee should be stated as provenance only. Add a support check that is labelled a suggestion, and route low-support sentences to human review. See Appendix B.

### 2. Some review sentences cannot carry a quote

The default review outline includes "gaps" and "disagreements", and neither fits the one-claim, one-quote rule:

- A gap claim asserts that something is absent, so there is nothing to quote.
- A disagreement claim synthesises several sources.
- A connective sentence such as "Three themes emerge" has no factual content.

Applied literally, "No source, no sentence" deletes all three kinds. The spec needs a sentence taxonomy with a grounding rule for each type. See Appendix B.

### 3. "Weigh" is the namesake stage and the least specified

Stage 7 lists stance, quality signals, recency and coverage. It has no algorithm, no output schema, no entity and no milestone.

`--limit 40` also implies ranking and truncation, but the pipeline has no rank or merge stage before the limit applies. That truncation is where bias enters, because citation-count ordering favours old, famous work.

The spec should define three things:

- the cross-provider merge and rank method;
- what Weigh outputs, at minimum a study-design label;
- that both are recorded per run.

### 4. It blurs narrative and systematic reviews

A relevance-ranked top 40 cannot support a systematic review, which needs exhaustive retrieval. PRISMA 2020 also expects things Winnow does not model:

- per-database search strings and search dates;
- counts per source database;
- a full-text eligibility stage;
- in practice, dual independent screening.

`Screening` has a single `reviewer` field. There are two ways to fix this:

- **Narrow the scope.** Limit v1 to narrative and scoping reviews and call the counts "PRISMA-inspired".
- **Add an exhaustive mode.** Allow uncapped retrieval with per-provider hit counts and multi-reviewer screening.

### 5. The verification states discard what cite-sight-core already provides

Version 0.13.3 of `cite-sight-core` exports these orthogonal fields:

- `VerificationStatus`: `verified | likely_valid | not_found | unverified | suspicious | format_only`
- `MatchCategory`, which includes `variant_record` and `not_indexed_expected`
- `UrlStatus`, kept separate from verification
- `PublicationCheck`, which reports retractions separately
- `unavailable`, for services that were down

Winnow collapses these into five states that mix three axes:

- `retracted` is an integrity flag, not an existence state.
- `dead` is a URL status.
- `suspicious`, the actual fabrication signal, has no equivalent.

Adopt the orthogonal model and derive citability as a rule over it. See Appendix A.

### 6. Verifying registry results is partly circular

Explore retrieves from OpenAlex and Crossref, then verifies against those same registries. Verification adds real value for imported reference files and grey literature. For registry-native hits it mainly adds cross-registry agreement and DOI resolution. State this openly; ADR 0002 already warns that users will confuse "found" with "verified".

### 7. Grey literature can be found but never cited

ADR 0002 makes sources without a DOI permanently uncitable, yet SearXNG and Brave search are on the roadmap. Government reports, WHO documents and standards are central in health, policy and education research.

Three changes would make grey literature usable:

- Use cite-sight's `not_indexed_expected` category.
- Add an ISBN verification route; the data model already stores ISBNs.
- Add a `user_attested` state, cited with a visible flag.

### 8. The reproducibility claim is too strong

AC8 says a run can be reproduced "from its audit log alone". But §5.6 stores only hashes, and several inputs drift:

- live API indexes and citation counts change;
- local model output varies with quantization and hardware, even at temperature 0;
- Ollama tags are mutable.

Hashes can detect drift but cannot reproduce a run. Store the full provider payloads, which are small at this corpus size, plus the model weight digest and prompt-template version. Then split AC8 into two claims:

- **Replay:** deterministic stages produce byte-identical output from stored inputs.
- **Re-execute:** a live rerun produces a drift report.

### 9. "Privacy-first" needs a threat model

Every query still tells OpenAlex, Crossref and Semantic Scholar what you are researching. Polite-pool access attaches an email address; cite-sight's `mailto` parameter does this. With bring-your-own-key (BYOK), the brief and evidence bundle go to a cloud provider.

None of this is disqualifying, but the spec should state what is protected from whom. It should also add:

- per-project consent before any frontier-model call, with a preview of the payload;
- query minimisation, so keywords leave the machine but thesis text does not;
- a precise logging rule in place of "redact identifiers where they could reveal a topic";
- prompt injection via abstracts as a threat in §13.

## Internal inconsistencies

The spec and ADRs contradict each other in eight places. Each needs a one-line fix.

| Where | Says | Conflicts with | Suggested fix |
| --- | --- | --- | --- |
| §8.2 | BibTeX includes verified, likely\_valid and retracted | AC5: "only verified or likely-valid" | Derive export from the citability rule in Appendix A |
| ADR 0005 | `winnow review --thesis` runs argument mode | §11 has a separate `winnow argue --thesis` | Keep `argue`; drop `--thesis` from `review` |
| ADR 0003 | No-model users lose extraction and drafting | §9.1 lists deterministic fallbacks for both | State that fallbacks exist but are marked degraded |
| §6.6 / `Stance` | `supports / opposes / mixed / unclear` | §6.5 map: `for / against / unclear` | One label set: add `mixed` to the map |
| §11 | `winnow search <topic>` takes no project | Examples run `init`, then `review <project>` | Add `--project`, or define a cwd convention |
| §10 | `Project.mode` | §6: modes are composable stages | Drop the field, or rename it `default_stage` |
| §11 | `--abstracts` is "default on" | A default-on flag can't be turned off | Replace with `--no-abstracts` |
| §11 | Exit codes 1 (partial) and 3 (nothing found) | No precedence when both apply | Make 3 win, and report the failed providers |

## Data model gaps

The §10 model is missing eight things that the principles and acceptance criteria depend on.

| Gap | Why it matters | Proposed change |
| --- | --- | --- |
| No run-to-source provenance | Per-database PRISMA counts and replay need to know which query, provider and rank found each source | Add `RunSource(run_id, source_id, query_id, provider, rank, raw_payload_id)` |
| No stored source text | The quote checker needs a fixed text to check against | Add `SourceText(source_id, kind, text, normalised_text, sha256, licence, fetched_at)` |
| `Extraction` has no suggested/confirmed split | Breaks principle 4; `Screening` and `Stance` already have this split | Add `suggested`, `confirmed`, `confirmed_by` |
| `Stance` has no target | A stance is relative to a thesis; changing the thesis should invalidate stances | Add `target_id`, a foreign key to a `Thesis` or `Brief` |
| Screening decisions overwrite | "Reversible" needs history | Make screening append-only; the current decision is the latest row |
| No draft lineage | User edits in v0.4 must re-trigger the checker | Add `Draft.parent_id` and `edited_by`; recheck on save |
| `doi` stored twice | It sits on both `Source` and `Identifier` | Keep it only in `Identifier`; add a view for convenience |
| No schema version | Per-project databases are long-lived | Add a `schema_version` table and a migration policy |

The spec should also define the gates between stages. Two decisions are open: whether Extract runs on model-suggested includes or only human-confirmed ones, and whether Argue may draft from unconfirmed stances. These decisions determine whether batch mode can run unattended.

## Smaller points

- **Prior art is understated.** §2 implies that search tools don't screen, but Rayyan, Covidence and ASReview do. Elicit extracts with supporting quotes, and scite labels citations as supporting or contrasting. Winnow's real differentiator (local, deterministic verification, open, auditable) holds up without a strawman.
- **Screening method.** ASReview-style active learning fits the local, small-model ethos better than LLM screening suggestions. It is cheap and well validated.
- **Evaluations arrive too late.** Stance accuracy, extraction accuracy and counter-evidence recall are core claims from v0.3, yet a benchmark arrives only at v1.0. Build evaluations alongside each feature. Recall against the included studies of published systematic reviews is a natural test, and public screening datasets such as SYNERGY exist.
- **The one-third cap on counter-evidence.** If the cap shapes the final result set, it misrepresents a literature that is mostly opposed. Apply it to the retrieval budget only, and report the stance distribution uncapped.
- **Query inversion is fragile.** Bag-of-words search treats "fails to" and "no evidence" as noise. Citation chasing on a highly cited paper returns thousands of results, so it needs a sampling strategy. As far as I know, OpenAlex does not expose citation contexts, so that mechanism relies on Semantic Scholar.
- **Brief criteria need sorting.** Heuristic filters cannot apply "preprints with code". Separate machine-applied filters (year, type, language) from criteria that a human or model judges.
- **Abstract-only evidence is thin.** Abstracts rarely state limitations or sample sizes. Every draft should declare its basis in the header, for example "abstracts only for 38 of 42 sources".
- **Quote matching needs a normalisation rule.** Crossref abstracts arrive as JATS XML, and OpenAlex supplies an inverted index. Define how whitespace, Unicode, hyphenation and tags are normalised before matching.
- **Performance target.** The real limits are rate limits and bot-blocking on URL checks, not 10 Mbps of bandwidth. Restate the target as a request budget.
- **Milestone order.** Screening through CSV round-trips until v0.4 is painful. A small TUI for screening at v0.2 may be worth more than an early desktop shell.
- **Dependency pinning.** npm shows `cite-sight-core` 1.0.0 (Feb 2026), while `latest` is 0.13.3, so `^1.0.0` silently resolves to the old release. Pin an exact version and define the interface contract Winnow expects.
- **Electron packaging.** `better-sqlite3` is a native module that must be rebuilt for each Electron version. Budget for this in v0.5.

## Recommended priority

Make these six changes before writing code. The rest can be handled as it comes up.

1. Replace the five verification states with the orthogonal model in Appendix A.
2. Rewrite §9.2 to separate provenance from support, and add the sentence taxonomy in Appendix B.
3. Scope v1 to narrative and scoping reviews, or specify an exhaustive mode.
4. Specify cross-provider ranking and the outputs of Weigh.
5. Store full provider payloads, and split AC8 into replay and re-execute.
6. Fix the eight inconsistencies and add the missing entities.

## Appendix A: proposed §8.1, verification model

This appendix is drop-in text for SPEC §8.1. It reuses cite-sight-core's types directly, so Winnow adds only `user_attested` and the citability rule. It changes the state list in ADR 0002; record that change in a new ADR that supersedes 0002's list.

### 8.1 Verification model

A source's verification record has five independent axes. No axis is derived from a model. Winnow stores every axis exactly as `cite-sight-core` reports it and never merges them into a single state.

| Axis | Values | Source |
| --- | --- | --- |
| Identity | `verified`, `likely_valid`, `unverified`, `not_found`, `suspicious`, `format_only`, `user_attested` | `VerificationStatus`; `user_attested` is Winnow's own |
| Match category | `exact`, `variant_record`, `metadata_drift`, `match_dubious`, `conflict`, `not_indexed_expected`, `none` | `MatchCategory` |
| Integrity notices | `none_found`, `retracted`, `expression_of_concern`, `correction`, `withdrawn` | `PublicationCheck.updates` |
| Link status | `live`, `dead`, `blocked`, `redirect`, `timeout`, `error`, `no_url` | `UrlStatus` |
| Check completeness | `complete`, `incomplete` with the unavailable service and reason | `unavailable` |

`none_found` means only that no registry reported a notice. It does not certify that the work was never retracted, and the UI must say so.

Link status is informational. A dead link alone never changes whether a source can be cited, because publishers often block automated checks.

#### Citability rule

Winnow derives citability from the axes with one deterministic function, `citability(record)`. The draft checker, the BibTeX exporter and the CSL-JSON exporter all call this same function.

| Result | Condition | Behaviour |
| --- | --- | --- |
| `citable` | Identity is `verified`, and the match category is `exact` or `variant_record` | Cited normally |
| `citable_marked` | Identity is `likely_valid`, or the match category is `metadata_drift` | Cited with a visible marker and a machine-readable flag |
| `citable_attested` | Identity is `user_attested`; this is the expected route for `not_indexed_expected` grey literature | Cited with an "attested by \<reviewer>" flag |
| `citable_warned` | Any citable result above, plus a `retracted`, `withdrawn` or `expression_of_concern` notice | Cited only with the notice stated inline in the draft sentence |
| `pending` | Check completeness is `incomplete` | Not citable until rechecked; never silently promoted |
| `not_citable` | Identity is `not_found`, `suspicious`, `format_only` or unattested `unverified`; or the match category is `match_dubious` or `conflict` | Listed in Explore output, excluded from drafts and exports |

Two invariants hold for every record:

1. No model output can change any axis or the citability result.
2. `user_attested` requires a named reviewer and a timestamp, stored as an `AuditEvent`. It can be applied only to identity `unverified` or `not_found`, never to `suspicious`.

#### Variant records

When the match category is `variant_record`, as with a preprint and its published version, Winnow links the two as versions of one work. It does not delete either one.

The version of record is canonical for citation. Both identifiers are kept. Citation counts are shown per version, with their provider, and are never summed silently.

#### Export

BibTeX and CSL-JSON export every record whose citability starts with `citable_`. Flags are written to CSL `note` and to a BibTeX `note` field, for example `winnow: likely_valid; retracted 2024`. `pending` and `not_citable` records are exported only to JSON and CSV, never to citation formats.

## Appendix B: proposed §9.2, evidence bundle and checker

This appendix is drop-in text that replaces SPEC §9.2 and adds §9.3–9.5. It keeps "No source, no sentence" as the provenance rule and adds an honest, reversible check for support.

### 9.2 Evidence bundle

Before drafting, Winnow builds an evidence bundle. The drafting prompt receives only this bundle and the brief. Each record holds:

- `claim_id`, `source_id`, and `source_text_sha256`, which pins the exact abstract or full-text version used;
- `quote` and its character span in the normalised source text;
- the extraction fields, each with its confirmed or suggested flag;
- the stance, with its target thesis and confirmed or suggested flag;
- the `citability` result from §8.1.

Only `citable_*` sources enter the bundle. Unconfirmed suggestions may enter only if the run's gate policy allows it, and they stay marked. The draft header reports how many unconfirmed suggestions it used.

The guarantee is stated as follows:

> Every cited source passed verification, and every quoted span occurs verbatim in the stored source text. Winnow does not guarantee that each sentence faithfully represents its quote. It flags likely misrepresentation for human review.

### 9.3 Sentence types

The drafting model must tag every output sentence with a type. An untagged sentence is treated as `evidence`.

| Type | Example | Grounding required |
| --- | --- | --- |
| `evidence` | "Smith et al. found a 12% reduction in fabricated citations." | One or more bundle claim IDs, each with its quote |
| `synthesis` | "Studies disagree on whether retrieval quality matters more than model size." | Two or more claim IDs; for a comparison, at least one per side |
| `coverage` | "None of the 42 included sources report non-English evaluations." | A named coverage query that Winnow computes over the corpus |
| `framing` | "Three themes emerge from the literature." | No claim IDs; linted, see §9.4 |

Gap claims are `coverage` sentences. Their numbers come from a deterministic query, never from the model.

### 9.4 Checks

Checks run in this order. Checks 1–5 are deterministic; check 6 is a labelled suggestion.

1. **Schema:** the output parses, and every sentence has a type and the required fields.
2. **IDs:** every cited ID is in the bundle and is `citable_*`.
3. **Quotes:** each normalised quote occurs exactly at its declared span in the normalised source text. Normalisation means NFKC, collapsed whitespace, line-break hyphens joined, JATS and HTML tags stripped, and curly quotes folded to straight. No fuzzy matching is allowed.
4. **Numbers:** every number in an `evidence` or `synthesis` sentence appears in one of its quotes. Every number in a `coverage` sentence equals the recomputed value. `framing` sentences may contain no numbers, study names or citations.
5. **Synthesis shape:** a `synthesis` sentence that states disagreement cites claims with differing confirmed or suggested stances.
6. **Support:** a separate model checks whether the quoted spans entail the sentence. It returns `supported`, `partial`, `unsupported` or `contradicted`. Where possible it should be a different model from the drafting model. The result is stored as a suggestion, with the model name and prompt version.

### 9.5 Outcomes

Every outcome is logged, and every non-dropped outcome is reversible by a human. `Claim.status` gains the values `kept_marked` and `held`.

| Check result | Claim status | In the rendered draft? |
| --- | --- | --- |
| Checks 1–5 fail | `dropped` | No; listed in the draft's evidence appendix with the reason |
| Support is `contradicted` or `unsupported` | `held` | No; shown in a review queue, and a human can restore it |
| Support is `partial` | `kept_marked` | Yes, with a visible marker |
| All checks pass | `kept` | Yes |

Any human edit to a draft re-runs checks 1–5 on the edited sentences. Check 6 runs on request.

The draft header states the drafting model and its digest, and the text basis (for example, "abstracts only for 38 of 42 sources"). It also gives the counts of kept, marked, held and dropped sentences.

### Proposed acceptance criteria for v0.3

1. On a planted-error set, checks 1–5 catch 100% of fabricated IDs, altered quotes, inflated numbers and wrong coverage counts.
2. On a labelled claim–quote set, the support checker's precision and recall for `unsupported` are measured and published with each release. There is no pass threshold in v0.3.
3. A draft with an empty review queue and zero dropped sentences is rendered identically by `winnow replay`.
