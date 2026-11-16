import { describe, expect, it } from 'vitest';
import type { RankedSource } from '../src/types.js';
import {
  formatBibtex,
  formatCsl,
  formatCsv,
  formatSearchJson,
  formatSourcesExport,
  formatTable,
  type StoredSourcesExportOptions,
} from '../src/export/format.js';

function source(overrides: Partial<RankedSource> = {}): RankedSource {
  return {
    source: {
      id: 'doi:10.1/test',
      title: 'A study of things',
      authors: ['Harris, Charles R.', 'Lovelace, Ada'],
      year: 2020,
      venue: 'Nature',
      type: 'journal-article',
      doi: '10.1/test',
      url: 'https://doi.org/10.1/test',
      abstract: 'This is the abstract of the study.',
      sourceProvider: 'crossref',
    },
    verification: {
      identity: 'verified',
      matchCategory: 'exact',
      integrity: ['none_found'],
      linkStatus: 'live',
      completeness: { status: 'complete' },
      confidence: 1,
      provider: 'crossref',
      checkedAt: '2026-11-11T00:00:00.000Z',
      evidence: {},
    },
    citability: 'citable',
    rrfScore: 0.5,
    rank: 1,
    selected: true,
    providers: [{ provider: 'crossref', rank: 1 }],
    ...overrides,
  };
}

describe('formatBibtex', () => {
  it('exports citable records and skips pending ones', () => {
    const pending = source({
      citability: 'pending',
      verification: {
        ...source().verification,
        completeness: { status: 'incomplete', service: 'crossref', reason: 'timeout' },
      },
    });

    const output = formatBibtex([source(), pending]);
    expect(output).toContain('@article{');
    expect(output).toContain('A study of things');
    expect(output).toContain('Harris, Charles R. and Lovelace, Ada');
    expect(output.match(/@article/g)).toHaveLength(1);
  });

  it('states a warning notice in the note field', () => {
    const retracted = source({
      citability: 'citable_warned',
      verification: {
        ...source().verification,
        integrity: ['retracted'],
      },
    });
    const output = formatBibtex([retracted]);
    expect(output).toContain('winnow: citable\\_warned');
    expect(output).toContain('retracted');
  });
});

describe('formatCsl', () => {
  it('exports structured CSL-JSON for citable records only', () => {
    const pending = source({ citability: 'not_citable' });
    const parsed = JSON.parse(formatCsl([source(), pending])) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.type).toBe('article-journal');
    expect(parsed[0]!.DOI).toBe('10.1/test');
    expect(parsed[0]!.author).toEqual([
      { family: 'Harris', given: 'Charles R.' },
      { family: 'Lovelace', given: 'Ada' },
    ]);
  });

  it('labels a citable_warned record in the note', () => {
    const warned = source({
      citability: 'citable_warned',
      verification: { ...source().verification, integrity: ['expression_of_concern'] },
    });
    const parsed = JSON.parse(formatCsl([warned])) as Array<Record<string, unknown>>;
    expect(String(parsed[0]!.note)).toContain('expression_of_concern');
  });
});

describe('formatSearchJson', () => {
  it('includes abstracts, metadata and counts', () => {
    const parsed = JSON.parse(
      formatSearchJson({
        runId: 'run-1',
        query: 'testing',
        startedAt: '2026-11-11T00:00:00.000Z',
        finishedAt: '2026-11-11T00:00:01.000Z',
        retrieved: 1,
        unique: 1,
        selectedCount: 1,
        citableCount: 1,
        sources: [source()],
        failures: [],
        payloads: [],
      }),
    ) as { citableCount: number; sources: Array<Record<string, unknown>> };

    expect(parsed.citableCount).toBe(1);
    expect(parsed.sources[0]!.abstract).toBe('This is the abstract of the study.');
    expect(parsed.sources[0]!.doi).toBe('10.1/test');
  });
});

describe('formatCsv and formatTable', () => {
  it('includes all ranked records in CSV with selection state', () => {
    const unselected = source({ rank: 2, selected: false, citability: 'pending' });
    const csv = formatCsv([source(), unselected]);
    expect(csv.split('\n').filter(Boolean)).toHaveLength(3);
    expect(csv).toContain('false');
  });

  it('prints abstracts in the table when enabled', () => {
    const output = formatTable([source()], true);
    expect(output).toContain('This is the abstract of the study.');
    expect(formatTable([source()], false)).not.toContain(
      'This is the abstract of the study.',
    );
  });
});

describe('variant notes', () => {
  it('notes alternate DOIs in BibTeX and CSL', () => {
    const alternate = source({
      source: { ...source().source, alternateDois: ['10.1/alt'] },
    });

    expect(formatBibtex([alternate])).toContain('also doi:10.1/alt');

    const parsed = JSON.parse(formatCsl([alternate])) as Array<
      Record<string, unknown>
    >;
    expect(String(parsed[0]!.note)).toContain('also doi:10.1/alt');
  });

  it('notes the version of record for a variant', () => {
    const variant = source({
      source: {
        ...source().source,
        variantOf: 'doi:10.1/a',
        isVersionOfRecord: false,
      },
    });

    expect(formatBibtex([variant])).toContain('version of doi:10.1/a');
  });
});

describe('formatSourcesExport', () => {
  function options(
    overrides: Partial<StoredSourcesExportOptions> = {},
  ): StoredSourcesExportOptions {
    return {
      runId: 'run-1',
      query: 'testing',
      startedAt: '2026-11-11T00:00:00.000Z',
      finishedAt: '2026-11-11T00:00:01.000Z',
      identified: 3,
      deduplicated: 2,
      failures: [],
      ranked: [source()],
      selected: [source()],
      ...overrides,
    };
  }

  it('exports the selected subset with the run counts', () => {
    const selected = source();
    const unselected = source({ rank: 2, selected: false, citability: 'pending' });
    const parsed = JSON.parse(
      formatSourcesExport('json', options({
        ranked: [selected, unselected],
        selected: [selected],
      })),
    ) as {
      runId: string;
      retrieved: number;
      unique: number;
      selectedCount: number;
      sources: Array<Record<string, unknown>>;
    };

    expect(parsed.runId).toBe('run-1');
    expect(parsed.retrieved).toBe(3);
    expect(parsed.unique).toBe(2);
    expect(parsed.selectedCount).toBe(1);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]!.selected).toBe(true);
  });

  it('keeps citation formats citable and shows the chosen rows in a table', () => {
    const citable = source();
    const pending = source({ rank: 2, selected: false, citability: 'pending' });

    const bibtex = formatSourcesExport('bibtex', options({
      ranked: [citable, pending],
      selected: [citable, pending],
    }));
    expect(bibtex.match(/@article/g)).toHaveLength(1);
    expect(bibtex).toContain('A study of things');

    const table = formatSourcesExport('table', options({
      ranked: [citable, pending],
      selected: [citable, pending],
    }));
    expect(table).toContain('A study of things');
    expect(table).toContain('This is the abstract of the study.');
  });
});
