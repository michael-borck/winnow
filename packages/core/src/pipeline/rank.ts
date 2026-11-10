import type { MergedCandidate, RankedSource, VerificationRecord } from '../types.js';
import { citability } from '../verification/citability.js';

const RRF_K = 60;

/** Reciprocal rank fusion across provider lists, then deterministic tie-breaks. */
export function rankCandidates(
  candidates: MergedCandidate[],
  verifications: Map<string, VerificationRecord>,
  options: { limit: number },
): RankedSource[] {
  const limit = Math.max(0, Math.trunc(options.limit));

  const scored = candidates.map((candidate) => {
    const verification = verifications.get(candidate.source.id);
    if (!verification) {
      throw new Error(`Missing verification for ${candidate.source.id}`);
    }

    const rrfScore = candidate.providers.reduce(
      (total, reference) => total + 1 / (RRF_K + reference.rank),
      0,
    );

    return {
      source: candidate.source,
      verification,
      citability: citability(verification),
      rrfScore,
      rank: 0,
      selected: false,
      providers: candidate.providers,
    } satisfies RankedSource;
  });

  scored.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;

    const aComplete = a.verification.completeness.status === 'complete' ? 1 : 0;
    const bComplete = b.verification.completeness.status === 'complete' ? 1 : 0;
    if (bComplete !== aComplete) return bComplete - aComplete;

    const aYear = a.source.year ?? 0;
    const bYear = b.source.year ?? 0;
    if (bYear !== aYear) return bYear - aYear;

    const aCitations = a.source.citationCount ?? 0;
    const bCitations = b.source.citationCount ?? 0;
    if (bCitations !== aCitations) return bCitations - aCitations;

    return a.source.title.localeCompare(b.source.title);
  });

  return scored.map((item, index) => ({
    ...item,
    rank: index + 1,
    selected: index < limit,
  }));
}
