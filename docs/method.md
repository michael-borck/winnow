# The Winnow method

Winnow separates three jobs that literature tools often blur: retrieval, verification, and judgement. Code does retrieval and verification. A human does judgement. A model can help with prose, but it never decides whether a source exists or whether a claim is true.

This page describes the method, the choices behind it, and the published guidance it follows. [SPEC.md](../SPEC.md) is the normative specification. The [ADRs](adr/README.md) record the reasons for individual decisions. The text below describes the method as specified, with a short implementation status section where v0.5 differs.

## Scope: narrative and scoping reviews

Winnow targets structured narrative reviews and scoping reviews. It does not claim to produce a systematic review. A relevance-ranked result set is not an exhaustive search. PRISMA 2020 reporting expects per-database search strings, counts for each database, a full-text eligibility stage, and in practice dual independent screening. Winnow does none of those end to end.

What it does report is a PRISMA-inspired flow: identified, deduplicated, screened, excluded by reason, included. Every export labels those counts as "PRISMA-inspired", never "PRISMA-compliant" (ADR 0009). That label is the honest position. It keeps the tool from implying a completeness it cannot prove.

The scope choice is deliberate. A narrative review needs a defensible account of what was searched, what was kept, and why. It does not need a review team's full machinery, and pretending to have that machinery would be worse than not having it.

## The method, step by step

### 1. Frame the question before searching

A brief records the question, optional thesis, scope, machine filters, and human criteria. The split matters. Dates, languages, publication types, and excluded venues are filters that code can apply. "Include studies that measure citation accuracy" is a criterion that a person has to judge. Mixing the two lets a keyword filter stand in for an inclusion decision.

If a source is excluded by a brief filter, Winnow flags and counts it by default. `--drop-excluded` hides flagged sources only after showing the count. A human include always wins (ADR 0012).

### 2. Retrieve from open indexes, and keep the record

The current implementation searches OpenAlex and Crossref, with Semantic Scholar used for citation chasing. Each run stores every retrieved record with its provider and rank, whether or not `--limit` selects it. It also stores the raw provider payloads.

Provider lists are fused with reciprocal rank fusion (RRF, k = 60) rather than by comparing provider scores that do not mean the same thing (ADR 0010; Cormack et al., 2009). Deterministic tie-breakers follow. The specification uses completeness, recency, citation percentile where the provider supplies it, and open-access availability. v0.5 uses completeness, recency, raw citation count, and title. Citation count is a tie-breaker, not a quality score or the main relevance signal. Winnow computes no composite quality score.

This is where the method refuses a common shortcut. The number of papers that report a finding is not a measure of the finding's strength. Five small surveys do not outweigh one well-run trial. Winnow ranks retrieval, then leaves the judgement about evidence strength to Weigh and to the reviewer.

### 3. Verify identity before anything is used

Every source carries five independent verification axes: identity, match category, integrity notices, link status, and check completeness (ADR 0007). A single deterministic function, `citability()`, turns those axes into a citability result. Drafts and citation exports use the same function.

No model touches verification. A model cannot turn a missing DOI into a verified record, and it cannot clear a retraction notice. Registry hits are also not independent discovery. OpenAlex and Crossref are both retrieval and verification sources, so a registry-native hit gets cross-registry agreement and a DOI resolution check, not a claim of independent verification (SPEC §8.1.2).

Verification proves identity. It does not prove that a source supports a sentence. That distinction is why the support check exists separately, and why a verified DOI is never presented as evidence on its own.

### 4. Screen as a human decision

Screening is an append-only record of human decisions: include, exclude, or maybe, with a priority tier, a reason code, and a reviewer. Suggestions live in a separate table. A suggestion never overwrites a decision, and changing a decision adds a row rather than erasing the old one.

Priority has three tiers: core, supporting, peripheral. Exclusion reasons are a controlled set plus free text. Brief exclusions are flags and counts, not silent removals. CSV and JSON round-trip decisions, and blank rows are ignored on import.

This is the part of the method that cannot be delegated. A model can suggest, and a heuristic can help with obvious filters, but the reviewer makes the call (ADR 0012).

### 5. Extract only what a human confirmed

Extraction reads only sources whose current decision is include. Each confirmed value belongs to one source and one field, with a quote where available and a location. Suggestions live separately and remain regenerable. The latest confirmed row per source and field wins.

The method treats extraction as a small, inspectable claim about a paper, not as a summary of the paper. A value that is not in the source should not arrive by inference. This is why the extraction suggestions are deliberately simple and why the confirmed store is separate from them (ADR 0013).

Cochrane's MECIR standards for collecting data call for a piloted data collection form, consistent fields, and independent duplicate extraction, mandatory for outcome data (Cochrane, C43-C51). Winnow supports consistent fields and stores the reviewer and quote. It does not yet implement independent duplicate extraction or a full MECIR workflow. Those belong to the deferred exhaustive mode in SPEC §18.

A rapid feasibility study by Schmidt et al. (2024) supports the separation. It reported around 80% accuracy when GPT-4 extracted study data from abstracts, with errors that included a hallucinated study design. That is useful as a suggestion engine and not good enough as an unreviewed source of evidence. Winnow keeps suggestions and confirmations on separate paths for that reason.

### 6. Weigh features, not a verdict

The weighting step records study design, source type, peer-review status, citation count with its provider and collection date, citation percentile where available, open-access status, quality flags, stance, and coverage counts. None of these silently excludes a source. A retraction or correction is shown. A small sample or industry funding is shown only when the source states it. Study design is a suggestion until a human confirms it.

The output is a set of inspectable features. It is not a quality score, and it does not pretend to be a risk-of-bias assessment.

### 7. Take a stance, then look for counter-evidence

Stance is relative to a thesis: supports, opposes, mixed, or unclear. Labels are human-confirmed, stored per source and thesis, and never overwritten by a suggestion. `--allow-suggested` can use suggestions when a label is missing, but the draft says so.

Counter-evidence is a retrieval pass, not a generation feature. `winnow counter` either runs a separate search with critical terms or chases papers that cite a DOI through Semantic Scholar. The results are saved as a separate run, not merged silently, and a null result is a valid outcome (ADR 0004, ADR 0020).

Citation chasing follows the snowballing idea: a known paper gives a start set, and forward citations extend it (Wohlin, 2014). Winnow keeps the citation contexts and samples critical ones first. It does not claim that the resulting set is complete.

### 8. Draft from a closed evidence bundle

Before drafting, Winnow builds an evidence bundle from confirmed includes and confirmed extraction values. Each claim carries a source ID and a quote. The specification also pins each quote to a character span and the source text to a hash (ADR 0008).

The writer can be a deterministic template or an OpenAI-compatible local model. The model sees the bundle and the brief, not the whole corpus. Malformed output is rejected, not repaired.

Every sentence is tagged as evidence, synthesis, coverage, or framing. Checks 1 to 5 then run deterministically:

1. Schema. The output parses and each sentence has the fields its type requires.
2. IDs. Every cited ID is in the bundle and citable. A warned source has its integrity notice in the same sentence.
3. Quotes. Each quote occurs in the normalised stored source text. No fuzzy matching.
4. Numbers. Every number in an evidence or synthesis sentence appears in one of its quotes. Coverage numbers must match a recomputed corpus query. Framing sentences contain no numbers, study names, or citations.
5. Synthesis shape. A synthesis sentence must cite at least two distinct sources. If it claims disagreement, the cited sources must carry differing stance labels.

`--support` adds a separate entailment check. The support model returns supported, partial, unsupported, or contradicted. It is a suggestion, not a gate. Unsupported and contradicted sentences are held and listed for review. Partial support is marked inline. If the support call fails, the sentence stays and the draft says the check did not run.

Nothing is deleted. Held sentences go to `winnow queue`, where a reviewer can restore or accept the hold. A restore creates a new draft revision with a reviewer and rationale, so the original draft and the override both remain (ADR 0019).

The guarantee is narrow on purpose: every cited source passed verification, and every quoted span occurs verbatim in the stored source text. Winnow does not guarantee that each sentence faithfully represents its quote. It flags likely misrepresentation for a human to review (SPEC §9.2).

### 9. Record what happened, and make replay possible

A run stores provider payloads, provider failures, ranks, and decisions. `winnow replay` re-normalises the stored payloads, re-deduplicates, re-ranks with the stored verification, and compares a deterministic snapshot hash (ADR 0011, ADR 0024). `winnow rerun --live` re-executes the same query against current providers, compares the source set, ranks, selection, citability and verification, and records the comparison as an audit event. Model artifacts and a gate-policy record are specified.

This is reproducibility as an audit trail. It is not a promise that a live search will return the same results tomorrow.

## Implementation status

The v0.5 build implements retrieval, verification, screening, extraction, stance, drafting, checks 1 to 5, the support pass, the hold queue, citation styles, citation chasing, replay, the web UI, and the Electron shell. A few guarantees are specified but not yet enforced:

- Quote checking verifies that a quote occurs in the stored source text. Span-exact matching and source-text hash pinning are specified, not yet in the bundle.
- The Weigh step is specified. Study design, quality flags, and coverage counts are not yet computed as a separate command.
- A per-project consent gate with a payload preview is specified for cloud models. v0.5 prints a warning when the model endpoint is not local.
- Independent duplicate extraction, exhaustive search mode, installers, and notarization are not implemented.

The method above describes the intended behaviour. Where the build is weaker, the tool should say so rather than imply the stronger guarantee.

## What the method does not claim

- It is not an exhaustive search. Retrieval is bounded and the limits are reported.
- It is not PRISMA-compliant. Counts are PRISMA-inspired and labelled as such.
- It does not replace dual independent screening, duplicate extraction, risk-of-bias assessment, or a full-text eligibility stage. Those are parts of a systematic review and are out of scope for v1.
- It does not turn citation counts into quality. Frequency is not strength.
- It does not guarantee that prose matches its sources. The support pass flags likely problems for review.
- It does not generate references. It exports only records that pass the citability rule.
- It does not default to a cloud model. Local is the default, and a non-local endpoint prints a warning. The specification adds a consent gate.

## Guidance and sources

The method draws on established review guidance and on evidence about where automation fails.

| Source | What Winnow takes | Where it stops |
|---|---|---|
| PRISMA 2020 (Page et al., 2021) | Transparent reporting, eligibility criteria, flow counts, a clear statement of search limits | Per-database search strings and counts, full-text eligibility, PRISMA compliance |
| Cochrane MECIR, C43-C51 | Piloted data collection, standard fields, source-linked extraction, independent duplicate extraction where the review requires it | Duplicate extraction and the full MECIR workflow are not implemented |
| Schmidt et al. (2024) | Model extraction is useful but error-prone, so suggestions stay separate from confirmed evidence | Winnow does not automate extraction decisions |
| Wohlin (2014) | Forward citation chasing as a complementary search strategy | Winnow does not claim a complete snowballing process |
| Cormack et al. (2009) | Reciprocal rank fusion for combining provider rankings | Ranking is not evidence weighting |

## References

Cochrane. Methodological Expectations of Cochrane Intervention Reviews (MECIR): Standards for the conduct of new Cochrane Intervention Reviews, C43-C51, "Collecting data from included studies."

Cormack, G. V., Clarke, C. L. A., & Buettcher, S. (2009). Reciprocal rank fusion outperforms Condorcet and individual rank learning methods. In Proceedings of the 32nd International ACM SIGIR Conference on Research and Development in Information Retrieval (pp. 758-759).

Page, M. J., McKenzie, J. E., Bossuyt, P. M., Boutron, I., Hoffmann, T. C., Mulrow, C. D., et al. (2021). The PRISMA 2020 statement: An updated guideline for reporting systematic reviews. BMJ, 372, n71. https://doi.org/10.1136/bmj.n71

Schmidt, L., Hair, K., Graziosi, S., Campbell, F., Kapp, C., Khanteymoori, A., Craig, D., Engelbert, M., & Thomas, J. (2024). Exploring the use of a large language model for data extraction in systematic reviews: A rapid feasibility study. arXiv:2405.14445.

Wohlin, C. (2014). Guidelines for snowballing in systematic literature studies and a replication in software engineering. In Proceedings of the 18th International Conference on Evaluation and Assessment in Software Engineering (EASE '14).

## Further reading

Johns Hopkins University Libraries. Synthesize: Write a literature review.

University of North Carolina at Chapel Hill Libraries. Step 7: Extract data from included studies.
