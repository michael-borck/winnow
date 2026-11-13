import type {
  DraftSentence,
  EvidenceBundle,
  StructuredDraft,
  SupportLabel,
  SupportResult,
} from '../drafting/drafting.js';
import {
  chatJson,
  ModelError,
  type ChatMessage,
  type ModelClientOptions,
} from './client.js';

export interface SupportCheckOutcome {
  draft: StructuredDraft;
  checked: number;
  failed: number;
  failures: Array<{ sentenceId: string; error: string }>;
}

const SUPPORT_LABELS = new Set<SupportLabel>([
  'supported',
  'partial',
  'unsupported',
  'contradicted',
]);

export async function applySupportCheck(
  draft: StructuredDraft,
  bundle: EvidenceBundle,
  options: ModelClientOptions,
): Promise<SupportCheckOutcome> {
  const sentences: DraftSentence[] = [];
  const failures: Array<{ sentenceId: string; error: string }> = [];
  let checked = 0;
  let failed = 0;

  for (const sentence of draft.sentences) {
    if (sentence.status !== 'kept' && sentence.status !== 'kept_marked') {
      sentences.push(sentence);
      continue;
    }
    if (sentence.type !== 'evidence' && sentence.type !== 'synthesis') {
      sentences.push(sentence);
      continue;
    }

    const quotes = supportQuotes(sentence, bundle);
    if (!quotes.length) {
      sentences.push({
        ...sentence,
        checks: [
          ...sentence.checks,
          { check: '6. support', ok: true, message: 'no quotes available' },
        ],
      });
      continue;
    }

    try {
      const raw = await chatJson(
        options,
        buildSupportMessages(sentence, quotes),
      );
      const result = parseSupport(raw, options.model);
      const status: DraftSentence['status'] =
        result.label === 'supported'
          ? 'kept'
          : result.label === 'partial'
            ? 'kept_marked'
            : 'held';
      sentences.push({
        ...sentence,
        support: result,
        status,
        checks: [
          ...sentence.checks.filter((item) => !item.check.startsWith('6.')),
          {
            check: '6. support',
            ok: result.label === 'supported' || result.label === 'partial',
            message: `${result.label}${result.rationale ? `: ${result.rationale}` : ''}`,
          },
        ],
      });
      checked += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ sentenceId: sentence.id, error: message });
      sentences.push({
        ...sentence,
        checks: [
          ...sentence.checks,
          {
            check: '6. support',
            ok: true,
            message: `not run: ${message}`,
          },
        ],
      });
    }
  }

  return { draft: { ...draft, sentences }, checked, failed, failures };
}

export function buildSupportMessages(
  sentence: DraftSentence,
  quotes: Array<{ sourceId: string; quote: string }>,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are an entailment checker. Decide whether the supplied quotes support the sentence. Use only the quotes, never outside knowledge. Return JSON only: {"label":"supported|partial|unsupported|contradicted","confidence":0-1,"rationale":"one sentence"}.',
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          sentence: stripCitationTokens(sentence.text),
          sentenceType: sentence.type,
          citations: sentence.citations,
          quotes,
          labels: {
            supported: 'the quotes entail the sentence',
            partial: 'the quotes support part of the sentence or only with caveats',
            unsupported: 'the quotes do not support the sentence',
            contradicted: 'the quotes contradict the sentence',
          },
        },
        null,
        2,
      ),
    },
  ];
}

function supportQuotes(
  sentence: DraftSentence,
  bundle: EvidenceBundle,
): Array<{ sourceId: string; quote: string }> {
  const quotes: Array<{ sourceId: string; quote: string }> = [];
  const seen = new Set<string>();
  const add = (sourceId: string, quote: string) => {
    const key = `${sourceId}\u0000${quote}`;
    if (seen.has(key)) return;
    seen.add(key);
    quotes.push({ sourceId, quote });
  };

  for (const quote of sentence.quotes) add(quote.sourceId, quote.quote);
  for (const id of sentence.citations) {
    for (const claim of bundle.claims.filter(
      (item) => item.sourceId === id,
    )) {
      add(claim.sourceId, claim.quote);
    }
  }

  return quotes.slice(0, 6);
}

function parseSupport(raw: unknown, model: string): SupportResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ModelError('Support check output must be an object');
  }
  const data = raw as Record<string, unknown>;
  if (
    typeof data.label !== 'string' ||
    !SUPPORT_LABELS.has(data.label as SupportLabel)
  ) {
    throw new ModelError(
      `Support label must be supported, partial, unsupported or contradicted; got ${JSON.stringify(data.label)}`,
    );
  }

  const confidence =
    typeof data.confidence === 'number'
      ? data.confidence
      : typeof data.confidence === 'string'
        ? Number(data.confidence)
        : undefined;
  const rationale =
    typeof data.rationale === 'string' ? data.rationale.trim() : undefined;

  return {
    label: data.label as SupportLabel,
    ...(confidence != null && Number.isFinite(confidence)
      ? { confidence }
      : {}),
    ...(rationale ? { rationale } : {}),
    model,
    method: 'model',
  };
}

function stripCitationTokens(text: string): string {
  return text.replace(/\{\{cite:[^}]+\}\}/g, ' ').replace(/\s+/g, ' ').trim();
}
