import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BriefError,
  briefId,
  formatBriefJson,
  formatBriefSummary,
  parseBrief,
  readBrief,
} from '../src/brief/brief.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-brief-'));
  temporaryDirectories.push(directory);
  return directory;
}

const FULL_BRIEF = `---
mode: argue
question: Does RAG reduce citation fabrication in literature reviews?
thesis: Verified retrieval reduces fabrication.
scope:
  date_range: 2018..2026
  disciplines: [computer science]
  languages: [en]
filters:
  types: [journal-article, preprint]
  languages: [en]
  open_access: true
criteria:
  include:
    - studies measuring citation accuracy
  exclude:
    - opinion pieces
counter: true
---
This project focuses on reviews published after 2018.
`;

describe('parseBrief', () => {
  it('parses the full brief shape and maps the scope date range into filters', () => {
    const parsed = parseBrief(FULL_BRIEF, { path: 'briefs/main.md' });

    expect(parsed.warnings).toEqual([]);
    expect(parsed.brief.mode).toBe('argue');
    expect(parsed.brief.question).toContain('citation fabrication');
    expect(parsed.brief.thesis).toBe('Verified retrieval reduces fabrication.');
    expect(parsed.brief.scope.dateRange).toEqual({ from: 2018, to: 2026 });
    expect(parsed.brief.scope.disciplines).toEqual(['computer science']);
    expect(parsed.brief.filters.since).toBe(2018);
    expect(parsed.brief.filters.until).toBe(2026);
    expect(parsed.brief.filters.types).toEqual(['journal-article', 'preprint']);
    expect(parsed.brief.filters.languages).toEqual(['en']);
    expect(parsed.brief.filters.openAccess).toBe(true);
    expect(parsed.brief.criteria.include).toHaveLength(1);
    expect(parsed.brief.criteria.exclude).toEqual(['opinion pieces']);
    expect(parsed.brief.counter).toBe(true);
    expect(parsed.brief.context).toContain('reviews published after 2018');
    expect(parsed.brief.path).toBe('briefs/main.md');
  });

  it('lets explicit filters override the scope date range with a warning', () => {
    const parsed = parseBrief(`---
question: A question
scope:
  date_range: 2018..2026
filters:
  since: 2020
---
`);

    expect(parsed.brief.filters.since).toBe(2020);
    expect(parsed.brief.filters.until).toBe(2026);
    expect(parsed.warnings).toEqual([
      {
        field: 'filters.since',
        message: 'overrides scope.date_range start (2018)',
      },
    ]);
  });

  it('requires a question or a thesis', () => {
    expect(() =>
      parseBrief(`---
mode: review
scope:
  disciplines: [history]
---
`),
    ).toThrow(BriefError);
  });

  it('requires a thesis in argument mode', () => {
    expect(() =>
      parseBrief(`---
mode: argue
question: A question without a thesis
---
`),
    ).toThrow('mode: argue requires a thesis');
  });

  it('rejects unclosed frontmatter and invalid YAML', () => {
    expect(() => parseBrief('---\nquestion: A question\n')).toThrow(
      'not closed',
    );
    expect(() => parseBrief('---\nquestion: [\n---\n')).toThrow('Invalid YAML');
  });

  it('warns about unknown fields instead of dropping them silently', () => {
    const parsed = parseBrief(`---
question: A question
unknown: value
filters:
  nope: true
---
`);
    expect(parsed.warnings.map((warning) => warning.field)).toEqual([
      'brief.unknown',
      'filters.nope',
    ]);
  });

  it('parses exclusion filters', () => {
    const parsed = parseBrief(`---
question: A question
filters:
  exclude_keywords: [press release, pilot study]
  exclude_venues: [Predatory Journal]
  exclude_domains: [example.com]
  exclude_types: [editorial]
---
`);
    expect(parsed.brief.filters.excludeKeywords).toEqual([
      'press release',
      'pilot study',
    ]);
    expect(parsed.brief.filters.excludeVenues).toEqual(['Predatory Journal']);
    expect(parsed.brief.filters.excludeDomains).toEqual(['example.com']);
    expect(parsed.brief.filters.excludeTypes).toEqual(['editorial']);
  });

  it('accepts object and array date ranges', () => {    const object = parseBrief(`---
question: A question
scope:
  date_range:
    from: 2015
    to: 2020
---
`);
    expect(object.brief.filters.since).toBe(2015);
    expect(object.brief.filters.until).toBe(2020);

    const array = parseBrief(`---
question: A question
scope:
  date_range: [2016, 2019]
---
`);
    expect(array.brief.filters.since).toBe(2016);
    expect(array.brief.filters.until).toBe(2019);
  });

  it('rejects a date range that starts after it ends', () => {
    expect(() =>
      parseBrief(`---
question: A question
scope:
  date_range: 2026..2018
---
`),
    ).toThrow('starts after it ends');
  });
});

describe('readBrief', () => {
  it('reads a brief from disk', async () => {
    const directory = await temporaryDirectory();
    const file = path.join(directory, 'brief.md');
    await writeFile(file, FULL_BRIEF, 'utf8');

    const parsed = await readBrief(file);
    expect(parsed.brief.path).toBe(file);
    expect(parsed.brief.thesis).toContain('Verified retrieval');
  });

  it('reports a missing file clearly', async () => {
    await expect(readBrief('/nonexistent/brief.md')).rejects.toThrow(
      'Cannot read brief',
    );
  });
});

describe('brief formatting and identity', () => {
  it('prints a readable summary and valid JSON', () => {
    const parsed = parseBrief(FULL_BRIEF);
    const summary = formatBriefSummary(parsed);
    expect(summary).toContain('Mode: argue');
    expect(summary).toContain('Filters: since 2018; until 2026');
    expect(summary).toContain('Criteria: 1 include, 1 exclude');

    const parsedJson = JSON.parse(formatBriefJson(parsed.brief)) as {
      thesis: string;
    };
    expect(parsedJson.thesis).toContain('Verified retrieval');
  });

  it('stable-hashes the brief content', () => {
    const first = parseBrief(FULL_BRIEF).brief;
    const second = parseBrief(FULL_BRIEF).brief;
    expect(briefId(first)).toBe(briefId(second));
    expect(briefId(first)).toMatch(/^brief-[a-f0-9]{16}$/);
  });
});
