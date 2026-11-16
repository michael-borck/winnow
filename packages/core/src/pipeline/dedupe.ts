import type {
  AcademicSource,
  MergedCandidate,
  ProviderReference,
  RetrievedCandidate,
} from '../types.js';
import { normaliseDoi, normaliseTitle } from '../text/normalise.js';
import { firstAuthorSurname, stableHash } from '../text/ids.js';

export function dedupeCandidates(
  candidates: RetrievedCandidate[],
): MergedCandidate[] {
  const exact = exactDedupe(candidates);
  const fuzzy = fuzzyMerge(exact);
  return linkVariants(fuzzy);
}

function exactDedupe(candidates: RetrievedCandidate[]): MergedCandidate[] {
  const byId = new Map<string, MergedCandidate>();

  for (const candidate of candidates) {
    const doi = candidate.source.doi
      ? normaliseDoi(candidate.source.doi)
      : undefined;
    const id = doi ? `doi:${doi}` : candidate.source.id;
    const reference: ProviderReference = {
      provider: candidate.provider,
      rank: candidate.providerRank,
      payloadId: candidate.payloadId,
    };

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        source: {
          ...candidate.source,
          id,
          doi,
          alternateDois: uniqueDois(candidate.source.alternateDois),
        },
        providers: [reference],
      });
      continue;
    }

    const merged = mergeSources(existing.source, candidate.source);
    existing.source = {
      ...merged,
      alternateDois: uniqueDois([
        ...(existing.source.alternateDois ?? []),
        ...(candidate.source.alternateDois ?? []),
      ]),
    };
    existing.providers.push(reference);
  }

  return [...byId.values()];
}

function fuzzyMerge(candidates: MergedCandidate[]): MergedCandidate[] {
  const groups = new Map<string, MergedCandidate[]>();
  const result: MergedCandidate[] = [];

  for (const candidate of candidates) {
    const key = fuzzyKey(candidate.source);
    if (!key) {
      result.push(candidate);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  for (const group of groups.values()) {
    result.push(group.length === 1 ? group[0]! : mergeGroup(group));
  }

  return result;
}

function mergeGroup(group: MergedCandidate[]): MergedCandidate {
  const ordered = [...group].sort(compareVersions);
  const base = ordered[0]!;
  let source: AcademicSource = { ...base.source };
  const providers = [...base.providers];

  for (const item of ordered.slice(1)) {
    source = mergeSources(source, item.source);
    providers.push(...item.providers);
  }

  const dois = uniqueDois([
    source.doi,
    ...(source.alternateDois ?? []),
    ...ordered.flatMap((item) => [
      item.source.doi,
      ...(item.source.alternateDois ?? []),
    ]),
  ]);
  const primaryDoi = source.doi ?? dois[0];

  source = {
    ...source,
    id: primaryDoi ? `doi:${primaryDoi}` : source.id,
    doi: primaryDoi,
    alternateDois: dois.filter((value) => value !== primaryDoi),
    variantOf: undefined,
  };

  return { source, providers };
}

function linkVariants(candidates: MergedCandidate[]): MergedCandidate[] {
  const groups = new Map<string, MergedCandidate[]>();
  const result: MergedCandidate[] = [];

  for (const candidate of candidates) {
    const key = variantKey(candidate.source);
    if (!key) {
      result.push({
        source: {
          ...candidate.source,
          isVersionOfRecord: candidate.source.isVersionOfRecord ?? true,
          variantOf: undefined,
        },
        providers: candidate.providers,
      });
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  for (const group of groups.values()) {
    const key = variantKey(group[0]!.source)!;
    if (group.length === 1) {
      const candidate = group[0]!;
      result.push({
        source: {
          ...candidate.source,
          workKey: key,
          isVersionOfRecord: true,
          variantOf: undefined,
        },
        providers: candidate.providers,
      });
      continue;
    }

    const ordered = [...group].sort(compareVersions);
    const canonical = ordered[0]!;

    for (const candidate of group) {
      const isCanonical = candidate.source.id === canonical.source.id;
      result.push({
        source: {
          ...candidate.source,
          workKey: key,
          isVersionOfRecord: isCanonical,
          variantOf: isCanonical ? undefined : canonical.source.id,
        },
        providers: candidate.providers,
      });
    }
  }

  return result;
}

function compareVersions(a: MergedCandidate, b: MergedCandidate): number {
  return (
    versionScore(b.source) - versionScore(a.source) ||
    (b.source.year ?? 0) - (a.source.year ?? 0) ||
    a.source.title.localeCompare(b.source.title)
  );
}

function versionScore(source: AcademicSource): number {
  let score = 0;
  if (source.doi) score += 4;
  if (!isPreprint(source)) score += 3;
  if (source.venue) score += 2;
  if (source.abstract) score += 1;
  if ((source.type ?? '').toLowerCase().includes('journal-article')) score += 1;
  return score;
}

function isPreprint(source: AcademicSource): boolean {
  const type = (source.type ?? '').toLowerCase();
  return (
    type.includes('preprint') ||
    type.includes('posted-content') ||
    source.sourceProvider === 'arxiv'
  );
}

function fuzzyKey(source: AcademicSource): string | undefined {
  const variant = variantKey(source);
  if (!variant) return undefined;
  return stableHash(
    `${variant}|${source.year ?? 'nd'}|${isPreprint(source) ? 'preprint' : 'published'}`,
  );
}

function variantKey(source: AcademicSource): string | undefined {
  const title = normaliseTitle(source.title);
  if (title.length < 20) return undefined;
  const author = firstAuthorSurname(source.authors[0]);
  if (!author) return undefined;
  return stableHash(`${title}|${author}`);
}

function uniqueDois(
  values: Array<string | undefined> | undefined,
): string[] {
  return [
    ...new Set(
      (values ?? [])
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => normaliseDoi(value)),
    ),
  ];
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