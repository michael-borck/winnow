import type {
  AcademicSource,
  MergedCandidate,
  ProviderReference,
  RetrievedCandidate,
} from '../types.js';
import { normaliseDoi } from '../text/normalise.js';

/** Merge duplicate records by identifier, keeping every provider's rank. */
export function dedupeCandidates(candidates: RetrievedCandidate[]): MergedCandidate[] {
  const byId = new Map<string, MergedCandidate>();

  for (const candidate of candidates) {
    const id = candidate.source.doi
      ? `doi:${normaliseDoi(candidate.source.doi)}`
      : candidate.source.id;
    const reference: ProviderReference = {
      provider: candidate.provider,
      rank: candidate.providerRank,
      payloadId: candidate.payloadId,
    };

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        source: { ...candidate.source, id },
        providers: [reference],
      });
      continue;
    }

    existing.source = mergeSources(existing.source, candidate.source);
    existing.providers.push(reference);
  }

  return [...byId.values()];
}

function mergeSources(a: AcademicSource, b: AcademicSource): AcademicSource {
  const abstract =
    (a.abstract?.length ?? 0) >= (b.abstract?.length ?? 0) ? a.abstract : b.abstract;
  const authors = a.authors.length >= b.authors.length ? a.authors : b.authors;
  const aCitations = a.citationCount ?? -1;
  const bCitations = b.citationCount ?? -1;
  const citationSource = aCitations >= bCitations ? a : b;

  return {
    ...a,
    title: a.title || b.title,
    authors,
    year: a.year ?? b.year,
    venue: a.venue ?? b.venue,
    type: a.type ?? b.type,
    doi: a.doi ?? b.doi,
    url: a.url ?? b.url,
    abstract,
    citationCount: citationSource.citationCount,
    citationProvider: citationSource.citationProvider,
    citationCollectedAt: citationSource.citationCollectedAt,
    openAccessUrl: a.openAccessUrl ?? b.openAccessUrl,
  };
}
