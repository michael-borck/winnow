import type { DatabaseSync } from 'node:sqlite';
import type { AcademicSource, Citability, IntegrityNotice } from '../types.js';
import type { Brief } from '../brief/brief.js';
import { loadExtractionState } from '../extraction/extraction.js';
import { isCitable } from '../verification/citability.js';
import { normaliseText } from '../text/normalise.js';
import { firstAuthorSurname, shortHash } from '../text/ids.js';

export type DraftSentenceType = 'evidence' | 'synthesis' | 'coverage' | 'framing';
export type DraftStatus = 'kept' | 'kept_marked' | 'held' | 'dropped';

export interface DraftQuote {
  sourceId: string;
  quote: string;
  location?: string;
}

export interface DraftCoverage {
  included?: number;
  sourcesWithEvidence?: number;
  claims?: number;
}

export interface DraftCheckResult {
  check: string;
  ok: boolean;
  message?: string;
}

export interface DraftSentence {
  id: string;
  text: string;
  type: DraftSentenceType;
  section: string;
  citations: string[];
  quotes: DraftQuote[];
  coverage?: DraftCoverage;
  status: DraftStatus;
  checks: DraftCheckResult[];
}

export interface EvidenceClaim {
  id: string;
  sourceId: string;
  sourceTitle: string;
  authors: string[];
  year: number | null;
  doi?: string;
  citability: Citability;
  integrity: IntegrityNotice[];
  field: string;
  value: string;
  quote: string;
  location?: string;
}

export interface EvidenceSource {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi?: string;
  venue?: string;
  citability: Citability;
  integrity: IntegrityNotice[];
  rank: number;
  fields: string[];
  abstract?: string;
}

export interface EvidenceBundle {
  runId: string;
  query: string;
  brief?: Brief;
  claims: EvidenceClaim[];
  sources: EvidenceSource[];
  counts: {
    included: number;
    withEvidence: number;
    claims: number;
  };
  unquoted: Array<{ sourceId: string; field: string; value: string }>;
}

export interface StructuredDraft {
  id: string;
  runId: string;
  mode: 'review';
  writer: 'template';
  title: string;
  sentences: DraftSentence[];
  createdAt: string;
  basis: {
    included: number;
    withEvidence: number;
    claims: number;
  };
}

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftError';
  }
}

export function buildEvidenceBundle(
  db: DatabaseSync,
  runId: string,
  fields: string[],
  brief?: Brief,
): EvidenceBundle {
  const state = loadExtractionState(db, runId, fields);
  const claims: EvidenceClaim[] = [];
  const sources: EvidenceSource[] = [];
  const unquoted: Array<{ sourceId: string; field: string; value: string }> = [];

  for (const row of state.rows) {
    const sourceFields: string[] = [];
    for (const field of fields) {
      const value = row.values[field];
      if (!value) continue;
      sourceFields.push(field);
      const quote =
        row.quotes[field] ??
        (field === 'quote' ? value : quoteFromAbstract(row.source, value));
      if (!quote) {
        unquoted.push({ sourceId: row.source.id, field, value });
        continue;
      }
      claims.push({
        id: `claim-${shortHash(`${row.source.id}|${field}|${value}|${quote}`)}`,
        sourceId: row.source.id,
        sourceTitle: row.source.title,
        authors: row.source.authors,
        year: row.source.year,
        ...(row.source.doi ? { doi: row.source.doi } : {}),
        citability: row.citability,
        integrity: row.verification.integrity,
        field,
        value,
        quote,
        ...(row.locations[field] ? { location: row.locations[field] } : {}),
      });
    }

    sources.push({
      id: row.source.id,
      title: row.source.title,
      authors: row.source.authors,
      year: row.source.year,
      ...(row.source.doi ? { doi: row.source.doi } : {}),
      ...(row.source.venue ? { venue: row.source.venue } : {}),
      citability: row.citability,
      integrity: row.verification.integrity,
      rank: row.rank,
      fields: sourceFields,
      ...(row.source.abstract ? { abstract: row.source.abstract } : {}),
    });
  }

  const withEvidence = new Set(claims.map((claim) => claim.sourceId)).size;

  return {
    runId,
    query: state.query,
    ...(brief ? { brief } : {}),
    claims,
    sources: sources.sort((a, b) => a.rank - b.rank),
    counts: {
      included: state.rows.length,
      withEvidence,
      claims: claims.length,
    },
    unquoted,
  };
}

export function generateTemplateDraft(
  bundle: EvidenceBundle,
  brief?: Brief,
): StructuredDraft {
  const sentences: DraftSentence[] = [];
  const title =
    brief?.question ??
    brief?.thesis ??
    `Literature review: ${bundle.query}`;

  sentences.push(
    sentence({
      text: 'This review reports only confirmed evidence. Each evidence sentence carries a citation and a quoted span.',
      type: 'framing',
      section: 'Overview',
    }),
  );

  const sourceWord = bundle.counts.included === 1 ? 'source' : 'sources';
  const haveWord = bundle.counts.withEvidence === 1 ? 'has' : 'have';
  const claimWord = bundle.counts.claims === 1 ? 'claim is' : 'claims are';

  sentences.push(
    sentence({
      text: `The review includes ${bundle.counts.included} ${sourceWord}; ${bundle.counts.withEvidence} ${haveWord} confirmed evidence and ${bundle.counts.claims} ${claimWord} available.`,
      type: 'coverage',
      section: 'Overview',
      coverage: {
        included: bundle.counts.included,
        sourcesWithEvidence: bundle.counts.withEvidence,
        claims: bundle.counts.claims,
      },
    }),
  );

  const fields = [...new Set(bundle.claims.map((claim) => claim.field))];
  for (const field of fields) {
    const section = titleCase(field);
    for (const claim of bundle.claims.filter((item) => item.field === field)) {
      const marker = citationMarker(claim);
      sentences.push(
        sentence({
          text: `{{cite:${claim.sourceId}}} ${asSentence(claim.value)}${marker}`,
          type: 'evidence',
          section,
          citations: [claim.sourceId],
          quotes: [
            {
              sourceId: claim.sourceId,
              quote: claim.quote,
              ...(claim.location ? { location: claim.location } : {}),
            },
          ],
        }),
      );
    }
  }

  const distinctCitations = [...new Set(bundle.claims.map((claim) => claim.sourceId))];
  if (distinctCitations.length >= 2) {
    sentences.push(
      sentence({
        text: `The confirmed evidence covers multiple sources. {{cite:${distinctCitations[0]}}} {{cite:${distinctCitations[1]}}}`,
        type: 'synthesis',
        section: 'Synthesis',
        citations: distinctCitations.slice(0, 2),
        quotes: [],
      }),
    );
  }

  if (bundle.unquoted.length) {
    sentences.push(
      sentence({
        text: 'Values without a quote are listed in the appendix and are not used as evidence.',
        type: 'framing',
        section: 'Synthesis',
      }),
    );
  }

  return {
    id: `draft-${shortHash(`${bundle.runId}|${bundle.claims.map((claim) => claim.id).join('|')}`)}`,
    runId: bundle.runId,
    mode: 'review',
    writer: 'template',
    title,
    sentences,
    createdAt: new Date().toISOString(),
    basis: bundle.counts,
  };
}

export function checkDraft(
  bundle: EvidenceBundle,
  draft: StructuredDraft,
): StructuredDraft {
  const sources = new Map(bundle.sources.map((source) => [source.id, source]));

  const checked = draft.sentences.map((item) => {
    const checks: DraftCheckResult[] = [];
    const plain = stripCitationTokens(item.text);

    // 1. Schema
    const schemaOk =
      Boolean(item.id && item.text.trim()) &&
      ['evidence', 'synthesis', 'coverage', 'framing'].includes(item.type) &&
      Array.isArray(item.citations) &&
      Array.isArray(item.quotes) &&
      (item.type !== 'evidence' ||
        (item.citations.length >= 1 && item.quotes.length >= 1)) &&
      (item.type !== 'synthesis' || item.citations.length >= 2) &&
      (item.type !== 'coverage' || Boolean(item.coverage)) &&
      (item.type !== 'framing' || item.citations.length === 0);
    checks.push(check('1. schema', schemaOk, schemaOk ? undefined : 'missing type, citations, quotes or coverage'));

    // 2. IDs
    const missing = item.citations.filter((id) => {
      const source = sources.get(id);
      return !source || !isCitable(source.citability);
    });
    let warnedOk = true;
    for (const id of item.citations) {
      const source = sources.get(id);
      if (!source) continue;
      const warning = warningNotice(source.integrity);
      if (
        source.citability === 'citable_warned' &&
        warning &&
        !plain.includes(warning)
      ) {
        warnedOk = false;
      }
    }
    checks.push(
      check(
        '2. IDs',
        missing.length === 0 && warnedOk,
        missing.length
          ? `missing or non-citable: ${missing.join(', ')}`
          : warnedOk
            ? undefined
            : 'a citable_warned source is missing its integrity notice',
      ),
    );

    // 3. Quotes
    const quoteFailures: string[] = [];
    for (const quote of item.quotes) {
      const source = sources.get(quote.sourceId);
      if (!source?.abstract) {
        quoteFailures.push(`${quote.sourceId}: no stored source text`);
        continue;
      }
      if (!normaliseText(source.abstract).includes(normaliseText(quote.quote))) {
        quoteFailures.push(`${quote.sourceId}: quote not found`);
      }
    }
    checks.push(
      check(
        '3. quotes',
        quoteFailures.length === 0,
        quoteFailures.length ? quoteFailures.join('; ') : undefined,
      ),
    );

    // 4. Numbers
    const numbers = plain.match(/\d+(?:[.,]\d+)?/g) ?? [];
    let numbersOk = true;
    let numbersMessage: string | undefined;
    if (item.type === 'evidence' || item.type === 'synthesis') {
      const text = item.quotes.map((quote) => normaliseText(quote.quote)).join(' ');
      const missingNumbers = numbers.filter((number) => !containsNumber(text, number));
      numbersOk = missingNumbers.length === 0;
      if (!numbersOk) numbersMessage = `numbers not in quotes: ${missingNumbers.join(', ')}`;
    } else if (item.type === 'coverage') {
      const values = Object.values(item.coverage ?? {}).filter(
        (value): value is number => typeof value === 'number',
      );
      const wrong = numbers.filter((number) => !values.includes(Number(number.replace(/,/g, ''))));
      numbersOk = wrong.length === 0;
      if (!numbersOk) numbersMessage = `coverage numbers do not match: ${wrong.join(', ')}`;
    } else if (item.type === 'framing') {
      numbersOk = numbers.length === 0;
      if (!numbersOk) numbersMessage = 'framing sentences must not contain numbers';
    }
    checks.push(check('4. numbers', numbersOk, numbersMessage));

    // 5. Synthesis shape
    const uniqueCitations = new Set(item.citations);
    let synthesisOk = item.type !== 'synthesis' || uniqueCitations.size >= 2;
    let synthesisMessage =
      item.type === 'synthesis' && uniqueCitations.size < 2
        ? 'synthesis needs at least two distinct claims'
        : undefined;
    if (
      item.type === 'synthesis' &&
      /\b(disagree|disagreement|contrast|mixed|however|oppos\w*)/i.test(plain)
    ) {
      synthesisOk = false;
      synthesisMessage =
        'disagreement language needs confirmed stance data, which this run does not have';
    }
    checks.push(check('5. synthesis shape', synthesisOk, synthesisMessage));

    // 6. Support is a suggestion and is not run without a support model.
    checks.push({
      check: '6. support',
      ok: true,
      message: 'not run (no support model)',
    });

    const failed = checks.some(
      (result) => !result.ok && !result.check.startsWith('6.'),
    );

    return {
      ...item,
      status: failed ? 'dropped' : 'kept',
      checks,
    } satisfies DraftSentence;
  });

  return { ...draft, sentences: checked };
}

export function renderDraftMarkdown(
  bundle: EvidenceBundle,
  draft: StructuredDraft,
): string {
  const kept = draft.sentences.filter((item) => item.status === 'kept');
  const dropped = draft.sentences.filter((item) => item.status === 'dropped');
  const sourcesById = new Map(bundle.sources.map((source) => [source.id, source]));
  const cited = new Set<string>();

  const lines: string[] = [`# ${draft.title}`, ''];

  lines.push(
    `*Template writer. ${kept.length} kept, ${dropped.length} dropped. ` +
      `${bundle.counts.included} included sources, ${bundle.counts.withEvidence} with confirmed evidence, ` +
      `${bundle.counts.claims} claims. Support check not run.*`,
    '',
  );

  let section = '';
  for (const item of kept) {
    if (item.section && item.section !== section) {
      section = item.section;
      lines.push(`## ${section}`, '');
    }
    for (const citation of item.citations) cited.add(citation);
    lines.push(`${renderSentence(item, sourcesById)}`, '');
  }

  if (bundle.unquoted.length) {
    lines.push('## Appendix: unquoted values', '');
    for (const item of bundle.unquoted) {
      lines.push(`- ${item.sourceId} · ${item.field}: ${item.value}`);
    }
    lines.push('');
  }

  if (dropped.length) {
    lines.push('## Appendix: dropped sentences', '');
    for (const item of dropped) {
      const reasons = item.checks
        .filter((result) => !result.ok)
        .map((result) => result.message ?? result.check)
        .join('; ');
      lines.push(`- ${item.text} — ${reasons}`);
    }
    lines.push('');
  }

  lines.push('## References', '');
  for (const id of [...cited]) {
    const source = sourcesById.get(id);
    if (!source) continue;
    lines.push(`- ${reference(source)}`);
  }
  lines.push('');

  return lines.join('\n');
}

export function formatDraftJson(draft: StructuredDraft): string {
  return `${JSON.stringify(draft, null, 2)}\n`;
}

function sentence(input: {
  text: string;
  type: DraftSentenceType;
  section: string;
  citations?: string[];
  quotes?: DraftQuote[];
  coverage?: DraftCoverage;
}): DraftSentence {
  return {
    id: `sentence-${shortHash(input.text)}`,
    text: input.text,
    type: input.type,
    section: input.section,
    citations: input.citations ?? [],
    quotes: input.quotes ?? [],
    ...(input.coverage ? { coverage: input.coverage } : {}),
    status: 'kept',
    checks: [],
  };
}

function check(name: string, ok: boolean, message?: string): DraftCheckResult {
  return { check: name, ok, ...(message ? { message } : {}) };
}

function quoteFromAbstract(
  source: AcademicSource,
  value: string,
): string | undefined {
  const abstract = source.abstract;
  if (!abstract) return undefined;
  const sentences = abstract
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.find((sentence) =>
    sentence.toLowerCase().includes(value.toLowerCase()),
  );
}

function citationMarker(claim: EvidenceClaim): string {
  if (claim.citability === 'citable_warned') {
    const notice = warningNotice(claim.integrity);
    return notice ? ` [${notice}]` : ' [integrity notice]';
  }
  if (claim.citability === 'citable_marked') return ' [likely valid]';
  if (claim.citability === 'citable_attested') return ' [attested]';
  return '';
}

function warningNotice(notices: IntegrityNotice[]): string | undefined {
  if (notices.includes('retracted')) return 'retracted';
  if (notices.includes('withdrawn')) return 'withdrawn';
  if (notices.includes('expression_of_concern')) return 'expression of concern';
  return undefined;
}

function renderSentence(
  item: DraftSentence,
  sources: Map<string, EvidenceSource>,
): string {
  let text = item.text;
  for (const id of item.citations) {
    const source = sources.get(id);
    if (!source) continue;
    text = text.replaceAll(`{{cite:${id}}}`, citationLabel(source));
  }
  return text;
}

function citationLabel(source: EvidenceSource): string {
  const surname = firstAuthorSurname(source.authors[0]) || 'Anon';
  const label = source.authors.length > 1 ? `${surname} et al.` : surname;
  return `(${label}, ${source.year ?? 'n.d.'})`;
}

function reference(source: EvidenceSource): string {
  const authors = source.authors.length ? source.authors.join(', ') : 'Unknown';
  const doi = source.doi ? ` https://doi.org/${source.doi}` : '';
  return `${authors} (${source.year ?? 'n.d.'}). ${source.title}. ${source.venue ?? ''}${doi}`.trim();
}

function stripCitationTokens(text: string): string {
  return text.replace(/\{\{cite:[^}]+\}\}/g, ' ').replace(/\s+/g, ' ').trim();
}

function containsNumber(text: string, number: string): boolean {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\d])${escaped}([^\\d]|$)`).test(text);
}

function asSentence(value: string): string {
  const clean = value.trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
