# Reviews

External reviews of the specification. Reviews are evidence, not normative
text: the spec changes only when a recommendation is accepted into `SPEC.md`
or an ADR.

## 2026-11-11 — Specification audit

**Document:** [2026-11-11-spec-audit.md](2026-11-11-spec-audit.md)
**Audited commit:** `1fe5a81`
**Dependency checked:** `@michaelborck/cite-sight-core@0.13.3`
**Status:** recommendations accepted in principle; SPEC v1.1 not yet written.

This audit supersedes the raw review conversation. It is the version to cite.
It contributes drop-in text for §8.1 (orthogonal verification and the
`citability()` rule) and §9.2–9.5 (evidence bundle, sentence taxonomy, checks
and outcomes).

### Disposition

| Finding | Lands in |
|---|---|
| 1. Provenance is not support | SPEC §5.2, §9.2–9.5; new ADR |
| 2. Sentence types and gap claims | SPEC §9.3; new ADR |
| 3. Weigh and pre-truncation ranking | SPEC §7, §10; new ADR |
| 4. Narrative vs systematic scope | SPEC §1, §2, §6, §12, non-goals |
| 5. Orthogonal verification axes | SPEC §8.1; ADR superseding 0002 |
| 6. Circular verification of registry hits | SPEC §8.1, UI wording |
| 7. Grey literature via `user_attested` | SPEC §8.1, §10 |
| 8. Replay vs re-execute | SPEC §5.6, §17, AC8 |
| 9. Privacy threat model and prompt injection | SPEC §13 |
| Inconsistencies (8) | One-line edits across SPEC/ADRs |
| Data-model gaps (8) | SPEC §10 |
| Smaller points | SPEC §2, §6.6, §12, §15, §16, §18 |

### Delta: issues the audit did not cover

These came from the review conversation and still need a SPEC v1.1 decision.

1. **Citation formatting.** CSL-JSON is not a formatted bibliography. Choose
   either a CSL style plus `citeproc-js`, or state that v1 is author-year only.
2. **Project location and `search` persistence.** Define where `winnow init`
   creates the project, and whether `winnow search` writes to a database when
   no project is named. The audit's `--project` fix does not settle this.
3. **Purge, backup and retention.** Add `winnow project delete --purge`, a
   cache-retention rule, and project export/import. Privacy requires a
   documented delete-everything path.
4. **Local model artifact provenance.** If Winnow downloads GGUF files, pin
   hashes and revisions the way cite-sight does, and verify on load. "Local"
   is not the same as "trusted".
5. **Argument-map schema.** `for / against / mixed / unclear` needs a defined
   output shape and a rule for weighing contradictory evidence. Otherwise
   Argue is three lists.
6. **Citation-fabrication benchmark.** The audit names SYNERGY and
   published-review recall. Add a planted-fabrication benchmark for Explore and
   export, not only for drafting.

### Correction to the audit

The audit's inconsistency table says exit code 3 ("nothing found") should win
over 1 ("partial failure"). This is inverted. If a provider failed, "nothing
found" may be false, and the root cause is the failure. Exit 1 takes
precedence, with the empty result reported as a consequence.
