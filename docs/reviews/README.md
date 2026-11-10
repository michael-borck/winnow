# Reviews

External reviews of the specification. Reviews are evidence, not normative
text: the spec changes only when a recommendation is accepted into `SPEC.md`
or an ADR.

## 2026-11-11 — Specification audit

**Document:** [2026-11-11-spec-audit.md](2026-11-11-spec-audit.md)
**Audited commit:** `1fe5a81`
**Dependency checked:** `@michaelborck/cite-sight-core@0.13.3`
**Status:** recommendations incorporated into SPEC v1.1 (2026-11-11); see SPEC §20.

This audit supersedes the raw review conversation. It is the version to cite.
It contributes drop-in text for §8.1 (orthogonal verification and the
`citability()` rule) and §9.2–9.5 (evidence bundle, sentence taxonomy, checks
and outcomes).

### Disposition

| Finding | Lands in |
|---|---|
| 1. Provenance is not support | SPEC §5.2, §9.2–9.5; ADR 0008 |
| 2. Sentence types and gap claims | SPEC §9.3; ADR 0008 |
| 3. Weigh and pre-truncation ranking | SPEC §7, §10; ADR 0010 |
| 4. Narrative vs systematic scope | SPEC §1, §2, §6, §12, non-goals; ADR 0009 |
| 5. Orthogonal verification axes | SPEC §8.1; ADR 0007 (supersedes 0002's state list) |
| 6. Circular verification of registry hits | SPEC §8.1, UI wording |
| 7. Grey literature via `user_attested` | SPEC §8.1, §10 |
| 8. Replay vs re-execute | SPEC §5.6, §17, AC8; ADR 0011 |
| 9. Privacy threat model and prompt injection | SPEC §13 |
| Inconsistencies (8) | One-line edits across SPEC/ADRs |
| Data-model gaps (8) | SPEC §10 |
| Smaller points | SPEC §2, §6.6, §12, §15, §16, §18 |

### Delta: issues the audit did not cover

These came from the review conversation and are now incorporated into SPEC v1.1.

1. **Citation formatting.** SPEC §9.6 uses `citeproc-js`, bundles APA 7, and
   accepts another style with `--style <file.csl>`.
2. **Project location and `search` persistence.** SPEC §11 defines
   `.winnow/project.json`, project discovery, ephemeral search and `--no-save`.
3. **Purge, backup and retention.** SPEC §11 and §13.2 add `project export`,
   `project delete --purge`, `cache purge`, and payload caps.
4. **Local model artifact provenance.** SPEC §9 pins weight digests,
   quantization and revision, and verifies on load.
5. **Argument-map schema.** SPEC §6.5 and §10 define the four stance labels, the
   node contents, the strongest opposing node and the change-the-conclusion
   field, stored as `ArgumentMap`.
6. **Citation-fabrication benchmark.** SPEC §16 adds a planted-fabrication set
   for verification and export, alongside SYNERGY and review recall.

### Correction to the audit

The audit's inconsistency table says exit code 3 ("nothing found") should win
over 1 ("partial failure"). This was inverted and is corrected in SPEC §11.1:
exit 1 takes precedence, with the empty result reported as a consequence.
