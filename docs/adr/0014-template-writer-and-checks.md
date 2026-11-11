# 0014. Template writer first; deterministic checks before rendering

**Status:** Accepted
**Date:** 2026-11-11

## Context

A fluent model can turn a thin evidence table into a confident review. The
project needs drafting, but it also needs the guarantee that every sentence is
traceable. Building the model writer first would make the checks an afterthought
and hide whether the evidence can support a draft at all.

## Decision

Ship a deterministic template writer before a model writer:

- Build an evidence bundle from confirmed extraction values that have quotes.
- Generate evidence sentences with a citation token and a quote; generate
  coverage sentences from bundle counts; generate one synthesis sentence only
  when at least two distinct sources exist.
- Run checks 1–5 before rendering: schema, citable IDs, verbatim quotes, numbers
  present in quotes or recomputed coverage, and synthesis shape.
- Do not run check 6 (support entailment) without a support model. Report it as
  not run rather than pretending it passed.
- Render only kept sentences. List dropped sentences in an appendix with the
  failing check and reason.
- Store the structured draft and the Markdown in the project database.

## Consequences

- The first drafts are thin, repetitive and honest. That is the point: they show
  whether the evidence exists before style is added.
- A model writer can replace the template without changing the bundle, checks or
  storage. It must emit the same structured sentence shape.
- Disagreement language needs confirmed stance data. Until that exists, the
  synthesis check drops it rather than guessing.
- Citation rendering is author-year only for now. `citeproc-js` and CSL styles
  come with the argument/counter-evidence work.
- Every draft is reproducible from the bundle, and every dropped sentence is
  visible rather than silently lost.
