import type {
  EvidenceBundle,
  DraftCoverage,
  DraftQuote,
  DraftSentence,
  DraftSentenceType,
  StructuredDraft,
} from '../drafting/drafting.js';
import { shortHash } from '../text/ids.js';
import {
  chatJson,
  ModelError,
  type ChatMessage,
  type ModelClientOptions,
} from './client.js';

export interface ModelWriterOptions extends ModelClientOptions {
  mode: 'review' | 'argue';
  thesis?: string;
}

const SENTENCE_TYPES = new Set<DraftSentenceType>([
  'evidence',
  'synthesis',
  'coverage',
  'framing',
]);

export function buildModelMessages(
  bundle: EvidenceBundle,
  options: ModelWriterOptions,
): ChatMessage[] {
  const stanceCounts = {
    supports: bundle.sources.filter((source) => source.stance === 'supports')
      .length,
    opposes: bundle.sources.filter((source) => source.stance === 'opposes')
      .length,
    mixed: bundle.sources.filter((source) => source.stance === 'mixed').length,
    unclear: bundle.sources.filter((source) => source.stance === 'unclear')
      .length,
    unlabelled: bundle.sources.filter((source) => !source.stance).length,
  };

  const payload = {
    task: options.mode,
    thesis: options.thesis ?? null,
    question: bundle.brief?.question ?? null,
    counts: {
      ...bundle.counts,
      ...stanceCounts,
    },
    sources: bundle.sources.map((source) => ({
      id: source.id,
      title: source.title,
      authors: source.authors,
      year: source.year,
      venue: source.venue ?? null,
      stance: source.stance ?? null,
    })),
    claims: bundle.claims.map((claim) => ({
      id: claim.id,
      sourceId: claim.sourceId,
      authors: claim.authors,
      year: claim.year,
      field: claim.field,
      value: claim.value,
      quote: claim.quote,
      location: claim.location ?? null,
      stance: claim.stance ?? null,
    })),
    output: {
      title: 'string',
      sentences: [
        {
          text: 'string; use {{cite:SOURCE_ID}} where a citation belongs',
          type: 'evidence | synthesis | coverage | framing',
          section: 'string',
          citations: ['SOURCE_ID'],
          quotes: [
            {
              sourceId: 'SOURCE_ID',
              quote: 'exact quote copied from a bundle claim',
              location: 'optional',
            },
          ],
          coverage: { optional: 'counts used by a coverage sentence' },
        },
      ],
    },
    rules: [
      'Use only the bundled sources and claims. Do not add sources, studies, quotes, statistics or facts.',
      'Every evidence sentence needs at least one citation and at least one quote copied verbatim from a claim.',
      'Use {{cite:SOURCE_ID}} tokens in text; the citation list must contain the same source IDs.',
      'Synthesis sentences need at least two distinct citations. Only claim disagreement when cited sources have differing stance labels.',
      'Coverage sentences may use only the supplied counts and must include a coverage object whose values match the numbers in the sentence.',
      'Framing sentences must contain no facts, numbers, study names or citations.',
      options.mode === 'argue'
        ? 'Use the sections Overview, Supporting evidence, Counter-evidence, Mixed evidence, Synthesis and What would change the conclusion.'
        : 'Use the sections Overview, Evidence, Synthesis, Gaps and Conclusion.',
      'Return JSON only, matching the output shape exactly.',
    ],
  };

  return [
    {
      role: 'system',
      content:
        'You are a careful literature review writer. You write only from the supplied evidence bundle. Never introduce a source, quote, statistic, study or fact that is not in the bundle. Every evidence sentence must cite source IDs with {{cite:SOURCE_ID}} tokens and include a quote copied verbatim from the bundle. Coverage sentences may state only supplied counts. Framing sentences must contain no facts, numbers or citations. Return JSON only.',
    },
    {
      role: 'user',
      content: JSON.stringify(payload, null, 2),
    },
  ];
}

export async function generateModelDraft(
  bundle: EvidenceBundle,
  options: ModelWriterOptions,
): Promise<StructuredDraft> {
  const raw = await chatJson(options, buildModelMessages(bundle, options));
  return parseModelDraft(raw, bundle, options);
}

export function parseModelDraft(
  raw: unknown,
  bundle: EvidenceBundle,
  options: ModelWriterOptions,
): StructuredDraft {
  const data = asRecord(raw, 'output');
  const title =
    typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : defaultTitle(bundle, options);
  const rows = data.sentences;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ModelError('Model output has no sentences');
  }

  const sentences = rows.map((row, index) => parseSentence(row, index));

  return {
    id: `draft-${shortHash(
      `${bundle.runId}|${options.mode}|${sentences.map((item) => item.text).join('|')}`,
    )}`,
    runId: bundle.runId,
    mode: options.mode,
    writer: 'model',
    model: options.model,
    title,
    sentences,
    createdAt: new Date().toISOString(),
    basis: bundle.counts,
  };
}

function parseSentence(raw: unknown, index: number): DraftSentence {
  const data = asRecord(raw, `sentence ${index + 1}`);
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) {
    throw new ModelError(`Model sentence ${index + 1} has no text`);
  }

  if (
    typeof data.type !== 'string' ||
    !SENTENCE_TYPES.has(data.type as DraftSentenceType)
  ) {
    throw new ModelError(
      `Model sentence ${index + 1} has an invalid type: ${JSON.stringify(data.type)}`,
    );
  }

  const citations = parseStringArray(data.citations, `sentence ${index + 1} citations`);
  const quotes = parseQuotes(data.quotes, index);
  const coverage = parseCoverage(data.coverage);
  const section =
    typeof data.section === 'string' && data.section.trim()
      ? data.section.trim()
      : 'Draft';

  return {
    id: `sentence-${shortHash(text)}`,
    text,
    type: data.type as DraftSentenceType,
    section,
    citations,
    quotes,
    ...(coverage ? { coverage } : {}),
    status: 'kept',
    checks: [],
  };
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new ModelError(`${field} must be an array`);
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseQuotes(value: unknown, index: number): DraftQuote[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new ModelError(`Model sentence ${index + 1} quotes must be an array`);
  }

  return value.map((quote, quoteIndex) => {
    const data = asRecord(quote, `sentence ${index + 1} quote ${quoteIndex + 1}`);
    if (typeof data.sourceId !== 'string' || !data.sourceId.trim()) {
      throw new ModelError(
        `Model sentence ${index + 1} quote ${quoteIndex + 1} needs sourceId`,
      );
    }
    if (typeof data.quote !== 'string' || !data.quote.trim()) {
      throw new ModelError(
        `Model sentence ${index + 1} quote ${quoteIndex + 1} needs quote`,
      );
    }
    return {
      sourceId: data.sourceId.trim(),
      quote: data.quote.trim(),
      ...(typeof data.location === 'string' && data.location.trim()
        ? { location: data.location.trim() }
        : {}),
    };
  });
}

function parseCoverage(value: unknown): DraftCoverage | undefined {
  if (value == null) return undefined;
  const data = asRecord(value, 'coverage');
  const coverage: DraftCoverage = {};
  for (const [key, raw] of Object.entries(data)) {
    const number =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim()
          ? Number(raw)
          : Number.NaN;
    if (Number.isFinite(number)) {
      (coverage as Record<string, number>)[key] = number;
    }
  }
  return Object.keys(coverage).length ? coverage : undefined;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function defaultTitle(
  bundle: EvidenceBundle,
  options: ModelWriterOptions,
): string {
  if (options.mode === 'argue') {
    return `Argument: ${options.thesis ?? bundle.query}`;
  }
  return (
    bundle.brief?.question ??
    bundle.brief?.thesis ??
    `Literature review: ${bundle.query}`
  );
}
