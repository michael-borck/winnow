import { describe, expect, it } from 'vitest';
import type { VerificationRecord } from '../src/types.js';
import { citability, isCitable } from '../src/verification/citability.js';

function record(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    identity: 'verified',
    matchCategory: 'exact',
    integrity: ['none_found'],
    linkStatus: 'live',
    completeness: { status: 'complete' },
    confidence: 1,
    provider: 'crossref',
    checkedAt: '2026-11-11T00:00:00.000Z',
    evidence: {},
    ...overrides,
  };
}

describe('citability', () => {
  it('cites a verified exact record', () => {
    expect(citability(record())).toBe('citable');
    expect(isCitable('citable')).toBe(true);
  });

  it('marks likely-valid and metadata-drift records', () => {
    expect(citability(record({ identity: 'likely_valid' }))).toBe('citable_marked');
    expect(citability(record({ matchCategory: 'metadata_drift' }))).toBe('citable_marked');
  });

  it('warns when an integrity notice is present', () => {
    expect(citability(record({ integrity: ['retracted'] }))).toBe('citable_warned');
    expect(
      citability(
        record({ identity: 'likely_valid', integrity: ['expression_of_concern'] }),
      ),
    ).toBe('citable_warned');
  });

  it('keeps an incomplete check pending, even if other axes look clean', () => {
    expect(
      citability(
        record({
          completeness: { status: 'incomplete', service: 'crossref', reason: 'timeout' },
        }),
      ),
    ).toBe('pending');
  });

  it('refuses not-found, suspicious and format-only records', () => {
    expect(citability(record({ identity: 'not_found', matchCategory: 'none' }))).toBe(
      'not_citable',
    );
    expect(citability(record({ identity: 'suspicious' }))).toBe('not_citable');
    expect(citability(record({ identity: 'format_only' }))).toBe('not_citable');
  });

  it('refuses dubious or conflicting matches', () => {
    expect(citability(record({ matchCategory: 'match_dubious' }))).toBe('not_citable');
    expect(citability(record({ matchCategory: 'conflict' }))).toBe('not_citable');
  });

  it('cites an attested grey-literature record without claiming registry identity', () => {
    expect(
      citability(
        record({
          identity: 'user_attested',
          matchCategory: 'not_indexed_expected',
        }),
      ),
    ).toBe('citable_attested');
  });

  it('warns an attested record with a retraction', () => {
    expect(
      citability(
        record({
          identity: 'user_attested',
          matchCategory: 'not_indexed_expected',
          integrity: ['retracted'],
        }),
      ),
    ).toBe('citable_warned');
  });

  it('does not cite an unattested unverified record', () => {
    expect(citability(record({ identity: 'unverified', matchCategory: 'none' }))).toBe(
      'not_citable',
    );
  });
});
