# 0007. Orthogonal verification axes and a single citability rule

**Status:** Accepted
**Date:** 2026-11-11
**Supersedes in part:** ADR 0002 (the five-state list only; the deterministic
principle stands)

## Context

`cite-sight-core@0.13.3` exports orthogonal fields: `VerificationStatus`,
`MatchCategory`, `UrlStatus`, `PublicationCheck` and `unavailable`. Winnow's
first spec collapsed them into `verified | likely_valid | unverified | retracted
| dead`. That mixed existence, match quality, integrity and link status:
`retracted` is not an existence state, `dead` is a URL status, and `suspicious`
— the actual fabrication signal — had no equivalent.

## Decision

Store all five axes exactly as reported and never merge them:

1. Identity.
2. Match category.
3. Integrity notices.
4. Link status.
5. Check completeness.

Derive citability with one ordered, deterministic function shared by the draft
checker and both citation exporters. Results are `citable`, `citable_marked`,
`citable_attested`, `citable_warned`, `pending` and `not_citable`. `user_attested`
is Winnow's only added identity value; it requires a named reviewer, a
timestamp, and can never apply to `suspicious`. Link status never changes
citability on its own.

## Consequences

- The UI must show the axes, not a single badge. "Retracted" is displayed as an
  integrity warning on a source that still exists.
- `pending` replaces silent promotion when a registry was unavailable.
- Grey literature becomes usable through `not_indexed_expected`,
  `user_attested` and an ISBN route.
- Variant records (preprint and published version) are linked, not deleted.
  Citation counts are shown per version and never summed silently.
- Exports and drafts share one citability rule, so they cannot disagree.
- Verification remains model-independent; a test asserts no model call.
