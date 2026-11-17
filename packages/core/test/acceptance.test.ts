import { describe, expect, it } from 'vitest';
import { checkDraft } from '../src/drafting/drafting.js';
import type {
  DraftSentence,
  EvidenceBundle,
  EvidenceClaim,
  EvidenceSource,
  StructuredDraft,
} from '../src/drafting/drafting.js';

function claim(
  id: string,
  sourceId: string,
  value: string,
  quote: string,
): EvidenceClaim {
  const doi = sourceId.replace(/^doi:/, '');
  return {
    id,
    sourceId,
    sourceTitle: `Study ${id}`,
    authors: ['Lovelace, Ada'],
    year: 2024,
    doi,
    citability: 'citable',
    integrity: ['none_found'],
    field: 'finding',
    value,
    quote,
  };
}

function bundle(): EvidenceBundle {
  const sources: EvidenceSource[] = [
    {
      id: 'doi:10.1/a',
      title: 'A study of retrieval',
      authors: ['Lovelace, Ada'],
      year: 2024,
      doi: '10.1/a',
      citability: 'citable',
      integrity: ['none_found'],
      stance: 'supports',
      rank: 1,
      fields: ['finding'],
      abstract:
        'We surveyed 120 students. The results show that retrieval improves accuracy.',
    },
    {
      id: 'doi:10.1/b',
      title: 'A study of synthesis',
      authors: ['Lovelace, Ada'],
      year: 2024,
      doi: '10.1/b',
      citability: 'citable',
      integrity: ['none_found'],
      stance: 'supports',
      rank: 2,
      fields: ['finding'],
      abstract:
        'We surveyed 80 students. The results show that retrieval reduces errors.',
    },
  ];

  return {
    runId: 'run-acceptance',
    query: 'testing',
    fields: ['finding'],
    counts: { included: 2, withEvidence: 2, claims: 2 },
    claims: [
      claim(
        'claim-1',
        'doi:10.1/a',
        'Retrieval improves accuracy.',
        'The results show that retrieval improves accuracy.',
      ),
      claim(
        'claim-2',
        'doi:10.1/b',
        'Retrieval reduces errors.',
        'The results show that retrieval reduces errors.',
      ),
    ],
    sources,
    unquoted: [],
  };
}

function draftWith(sentence: DraftSentence): StructuredDraft {
  const evidence = bundle();
  return {
    id: 'draft-acceptance',
    runId: evidence.runId,
    mode: 'review',
    writer: 'template',
    fields: ['finding'],
    title: 'Acceptance draft',
    sentences: [sentence],
    createdAt: '2026-11-16T00:00:00.000Z',
    basis: evidence.counts,
  };
}

function sentence(
  overrides: Partial<DraftSentence> & Pick<DraftSentence, 'id' | 'text' | 'type'>,
): DraftSentence {
  return {
    section: 'Finding',
    citations: [],
    quotes: [],
    status: 'kept',
    checks: [],
    ...overrides,
  };
}

interface Case {
  name: string;
  check: string;
  message: string;
  sentence: DraftSentence;
  bundle?: EvidenceBundle;
}

const cases: Case[] = [
  {
    name: 'fabricated source ID',
    check: '2. IDs',
    message: 'missing or non-citable',
    sentence: sentence({
      id: 's-fabricated',
      text: '{{cite:doi:10.1/missing}} A claim.',
      type: 'evidence',
      citations: ['doi:10.1/missing'],
      quotes: [
        {
          sourceId: 'doi:10.1/a',
          quote: 'The results show that retrieval improves accuracy.',
        },
      ],
    }),
  },
  {
    name: 'altered quote',
    check: '3. quotes',
    message: 'quote not found',
    sentence: sentence({
      id: 's-altered-quote',
      text: '{{cite:doi:10.1/a}} A claim.',
      type: 'evidence',
      citations: ['doi:10.1/a'],
      quotes: [
        {
          sourceId: 'doi:10.1/a',
          quote: 'The results show that retrieval improves accuracy!',
        },
      ],
    }),
  },
  {
    name: 'wrong quote span',
    check: '3. quotes',
    message: 'span mismatch',
    sentence: sentence({
      id: 's-span',
      text: '{{cite:doi:10.1/a}} A claim.',
      type: 'evidence',
      citations: ['doi:10.1/a'],
      quotes: [
        {
          sourceId: 'doi:10.1/a',
          quote: 'The results show that retrieval improves accuracy.',
          start: 0,
          end: 5,
        },
      ],
    }),
  },
  {
    name: 'inflated number',
    check: '4. numbers',
    message: 'numbers not in quotes',
    sentence: sentence({
      id: 's-number',
      text: '{{cite:doi:10.1/a}} Retrieval improves accuracy by 50%.',
      type: 'evidence',
      citations: ['doi:10.1/a'],
      quotes: [
        {
          sourceId: 'doi:10.1/a',
          quote: 'The results show that retrieval improves accuracy.',
        },
      ],
    }),
  },
  {
    name: 'wrong coverage count',
    check: '4. numbers',
    message: 'coverage numbers do not match',
    sentence: sentence({
      id: 's-coverage',
      text: 'The review includes 5 sources.',
      type: 'coverage',
      citations: [],
      quotes: [],
      coverage: { included: 2 },
    }),
  },
  {
    name: 'framing sentence with a number',
    check: '4. numbers',
    message: 'framing sentences',
    sentence: sentence({
      id: 's-framing-number',
      text: '3 themes emerge from the literature.',
      type: 'framing',
      citations: [],
      quotes: [],
    }),
  },
  {
    name: 'framing sentence with a citation token',
    check: '4. numbers',
    message: 'citations',
    sentence: sentence({
      id: 's-framing-citation',
      text: 'See {{cite:doi:10.1/a}} for details.',
      type: 'framing',
      citations: [],
      quotes: [],
    }),
  },
  {
    name: 'framing sentence with a study title',
    check: '4. numbers',
    message: 'study titles',
    sentence: sentence({
      id: 's-framing-title',
      text: 'A study of retrieval reports the finding.',
      type: 'framing',
      citations: [],
      quotes: [],
    }),
  },
  {
    name: 'synthesis with one source',
    check: '1. schema',
    message: 'missing type, citations, quotes or coverage',
    sentence: sentence({
      id: 's-synthesis-one',
      text: 'The evidence is clear. {{cite:doi:10.1/a}}',
      type: 'synthesis',
      citations: ['doi:10.1/a'],
      quotes: [],
    }),
  },
];

describe('planted-error acceptance set', () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const evidence = testCase.bundle ?? bundle();
      const checked = checkDraft(
        evidence,
        draftWith(testCase.sentence),
      ).sentences[0]!;

      expect(checked.status).toBe('dropped');
      const failed = checked.checks.find((item) =>
        item.check.startsWith(testCase.check),
      );
      expect(failed?.ok).toBe(false);
      expect(failed?.message).toContain(testCase.message);
    });
  }

  it('drops disagreement when the cited stances are the same', () => {
    const evidence = bundle();
    const checked = checkDraft(
      evidence,
      draftWith(
        sentence({
          id: 's-same-stance',
          text: 'The evidence disagrees. {{cite:doi:10.1/a}} {{cite:doi:10.1/b}}',
          type: 'synthesis',
          citations: ['doi:10.1/a', 'doi:10.1/b'],
          quotes: [],
        }),
      ),
    ).sentences[0]!;

    expect(checked.status).toBe('dropped');
    expect(
      checked.checks.find((item) => item.check.startsWith('5.'))?.message,
    ).toContain('differing stances');
  });

  it('keeps disagreement when the cited stances differ', () => {
    const evidence = bundle();
    const second = evidence.sources.find(
      (item) => item.id === 'doi:10.1/b',
    )!;
    second.stance = 'opposes';

    const checked = checkDraft(
      evidence,
      draftWith(
        sentence({
          id: 's-different-stance',
          text: 'The evidence disagrees. {{cite:doi:10.1/a}} {{cite:doi:10.1/b}}',
          type: 'synthesis',
          citations: ['doi:10.1/a', 'doi:10.1/b'],
          quotes: [],
        }),
      ),
    ).sentences[0]!;

    expect(checked.status).toBe('kept');
  });
});