import { describe, expect, it } from 'vitest';
import {
  formatBibliography,
  formatCitation,
  normaliseStyle,
  type CslSource,
} from '../src/citation/csl.js';
import type { EvidenceBundle, StructuredDraft } from '../src/drafting/drafting.js';
import { renderDraftMarkdown } from '../src/drafting/drafting.js';

const sources: CslSource[] = [
  {
    id: 'doi:10.1/a',
    title: 'A study of retrieval',
    authors: ['Lovelace, Ada'],
    year: 2024,
    venue: 'Journal of Testing',
    type: 'journal-article',
    doi: '10.1/a',
    url: 'https://doi.org/10.1/a',
  },
];

describe('citation styles', () => {
  it('renders author-date and numeric citations', () => {
    expect(formatCitation(sources, 'apa')).toContain('Lovelace');
    expect(formatCitation(sources, 'vancouver')).toContain('1');
    expect(normaliseStyle('harvard')).toBe('harvard');
    expect(() => normaliseStyle('mla')).toThrow('Unknown citation style');
  });

  it('renders a bibliography entry from the source metadata', () => {
    const bibliography = formatBibliography(sources, 'apa').join(' ');
    expect(bibliography).toContain('Lovelace');
    expect(bibliography).toContain('2024');
    expect(bibliography).toContain('A study of retrieval');
  });
});

describe('draft rendering with a citation style', () => {
  it('uses the chosen style in text and references', () => {
    const bundle: EvidenceBundle = {
      runId: 'run-citation-1',
      query: 'retrieval',
      counts: { included: 1, withEvidence: 1, claims: 1 },
      claims: [
        {
          id: 'claim-1',
          sourceId: 'doi:10.1/a',
          sourceTitle: 'A study of retrieval',
          authors: ['Lovelace, Ada'],
          year: 2024,
          citability: 'citable',
          integrity: ['none_found'],
          field: 'finding',
          value: 'Retrieval improves accuracy.',
          quote: 'The results show that retrieval improves accuracy.',
        },
      ],
      sources: [
        {
          id: 'doi:10.1/a',
          title: 'A study of retrieval',
          authors: ['Lovelace, Ada'],
          year: 2024,
          venue: 'Journal of Testing',
          type: 'journal-article',
          citability: 'citable',
          integrity: ['none_found'],
          rank: 1,
          fields: ['finding'],
          abstract: 'The results show that retrieval improves accuracy.',
        },
      ],
      unquoted: [],
    };

    const draft: StructuredDraft = {
      id: 'draft-1',
      runId: 'run-citation-1',
      mode: 'review',
      writer: 'template',
      title: 'A review',
      sentences: [
        {
          id: 'sentence-1',
          text: '{{cite:doi:10.1/a}} The results show that retrieval improves accuracy.',
          type: 'evidence',
          section: 'Finding',
          citations: ['doi:10.1/a'],
          quotes: [
            {
              sourceId: 'doi:10.1/a',
              quote: 'The results show that retrieval improves accuracy.',
            },
          ],
          status: 'kept',
          checks: [],
        },
      ],
      createdAt: '2026-11-11T00:00:00.000Z',
      basis: { included: 1, withEvidence: 1, claims: 1 },
    };

    const markdown = renderDraftMarkdown(bundle, draft, 'vancouver');
    expect(markdown).toContain('(1)');
    expect(markdown).toContain('## References');
    expect(markdown).toContain('A study of retrieval');
  });
});
