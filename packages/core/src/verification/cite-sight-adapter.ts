import { checkUrl, resolveDoi } from '@michaelborck/cite-sight-core';
import type { AcademicWork } from '@michaelborck/cite-sight-core';
import type {
  AcademicSource,
  Identity,
  IntegrityNotice,
  LinkStatus,
  MatchCategory,
  LookupFailureReason,
  VerificationRecord,
} from '../types.js';
import { normaliseDoi } from '../text/normalise.js';

export interface VerifyOptions {
  mailto?: string;
  /** Probe the landing page. Informational only; never changes citability. */
  checkLinks?: boolean;
}

export interface VerifiedDoi {
  record: VerificationRecord;
  work: AcademicWork | null;
}

/** Verify a DOI independently of any retrieval provider. */
export async function verifyDoi(doi: string, options: VerifyOptions = {}): Promise<VerifiedDoi> {
  const clean = normaliseDoi(doi);

  try {
    const work = await resolveDoi(clean, options.mailto);
    if (!work) {
      return {
        work: null,
        record: {
          identity: 'not_found',
          matchCategory: 'none',
          integrity: ['none_found'],
          linkStatus: 'no_url',
          completeness: { status: 'complete' },
          confidence: 0,
          provider: 'doi-resolver',
          checkedAt: new Date().toISOString(),
          evidence: { doi: clean, found: false },
        },
      };
    }

    const hasMetadata = work.title.trim().length > 0;
    const identity: Identity = hasMetadata ? 'verified' : 'likely_valid';
    const matchCategory: MatchCategory = hasMetadata ? 'exact' : 'metadata_drift';
    const { notices, unmapped } = integrityFromWork(work);
    const linkStatus = await probeLink(work, options);

    return {
      work,
      record: {
        identity,
        matchCategory,
        integrity: notices,
        linkStatus,
        completeness: { status: 'complete' },
        confidence: hasMetadata ? 1 : 0.5,
        provider: work.source,
        checkedAt: new Date().toISOString(),
        evidence: {
          doi: clean,
          found: true,
          source: work.source,
          title: work.title || null,
          linkChecked: options.checkLinks !== false,
          publicationCheckedAt: work.publicationStatusCheckedAt ?? null,
          unmappedUpdates: unmapped,
        },
      },
    };
  } catch (error) {
    const detail = error as { service?: unknown; reason?: unknown };
    const service = typeof detail.service === 'string' ? detail.service : 'doi-resolver';
    const reason = normaliseReason(detail.reason);

    return {
      work: null,
      record: {
        identity: 'unverified',
        matchCategory: 'none',
        integrity: ['none_found'],
        linkStatus: 'no_url',
        completeness: { status: 'incomplete', service, reason },
        confidence: 0,
        provider: service,
        checkedAt: new Date().toISOString(),
        evidence: {
          doi: clean,
          error: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

/**
 * Verify a retrieval result. Registry-native hits are checked through an
 * independent DOI resolution; a record without a DOI stays unverified and is
 * listed but not citable.
 */
export async function verifySource(
  source: AcademicSource,
  options: VerifyOptions = {},
): Promise<VerificationRecord> {
  if (source.doi) {
    const { record } = await verifyDoi(source.doi, options);
    return record;
  }

  return {
    identity: 'unverified',
    matchCategory: 'not_indexed_expected',
    integrity: ['none_found'],
    linkStatus: await probeUrl(source.url, options),
    completeness: { status: 'complete' },
    confidence: 0.2,
    provider: source.sourceProvider,
    checkedAt: new Date().toISOString(),
    evidence: {
      reason: 'no DOI; existence not independently confirmed',
      linkChecked: options.checkLinks !== false,
    },
  };
}

function integrityFromWork(work: AcademicWork): {
  notices: IntegrityNotice[];
  unmapped: string[];
} {
  const notices = new Set<IntegrityNotice>();
  const unmapped: string[] = [];

  for (const update of work.publicationUpdates ?? []) {
    const type = update.type.toLowerCase();
    if (type.includes('retract')) notices.add('retracted');
    else if (type.includes('withdraw')) notices.add('withdrawn');
    else if (type.includes('expression') || type.includes('concern')) {
      notices.add('expression_of_concern');
    } else if (
      type.includes('correction') ||
      type.includes('corrigendum') ||
      type.includes('erratum')
    ) {
      notices.add('correction');
    } else {
      unmapped.push(update.type);
    }
  }

  // "No notice found" is not proof a work was never retracted. The UI says so.
  if (notices.size === 0) notices.add('none_found');
  return { notices: [...notices], unmapped };
}

async function probeLink(work: AcademicWork, options: VerifyOptions): Promise<LinkStatus> {
  const url = work.url ?? (work.doi ? `https://doi.org/${work.doi}` : undefined);
  return probeUrl(url, options);
}

async function probeUrl(url: string | undefined, options: VerifyOptions): Promise<LinkStatus> {
  if (!url) return 'no_url';
  if (options.checkLinks === false) return 'no_url';
  try {
    return (await checkUrl(url)).status;
  } catch {
    return 'error';
  }
}

function normaliseReason(reason: unknown): LookupFailureReason {
  switch (reason) {
    case 'rate_limited':
    case 'timeout':
    case 'server_error':
    case 'network':
    case 'unknown':
      return reason;
    default:
      return 'unknown';
  }
}
