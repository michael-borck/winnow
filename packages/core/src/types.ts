/**
 * Winnow's core data types.
 *
 * The verification types mirror the orthogonal model exported by
 * `@michaelborck/cite-sight-core`. Winnow adds `user_attested` to identity and
 * keeps the axes separate. Citability is derived, never stored as a single
 * verification state.
 */

export type Identity =
  | 'verified'
  | 'likely_valid'
  | 'unverified'
  | 'not_found'
  | 'suspicious'
  | 'format_only'
  | 'user_attested';

export type MatchCategory =
  | 'exact'
  | 'variant_record'
  | 'metadata_drift'
  | 'match_dubious'
  | 'conflict'
  | 'not_indexed_expected'
  | 'none';

export type IntegrityNotice =
  | 'none_found'
  | 'retracted'
  | 'expression_of_concern'
  | 'correction'
  | 'withdrawn';

export type LinkStatus =
  | 'live'
  | 'dead'
  | 'blocked'
  | 'redirect'
  | 'timeout'
  | 'error'
  | 'no_url';

export type LookupFailureReason =
  | 'rate_limited'
  | 'timeout'
  | 'server_error'
  | 'network'
  | 'unknown';

export type CheckCompleteness =
  | { status: 'complete' }
  | { status: 'incomplete'; service: string; reason: LookupFailureReason };

export type Citability =
  | 'citable'
  | 'citable_marked'
  | 'citable_attested'
  | 'citable_warned'
  | 'pending'
  | 'not_citable';

export type ScreeningDecision = 'include' | 'exclude' | 'maybe';

export type ScreeningStance = 'supports' | 'opposes' | 'mixed' | 'unclear';

export type ScreeningRelevance = 'core' | 'supporting' | 'peripheral';

export type ScreeningReasonCode =
  | 'off_topic'
  | 'wrong_population'
  | 'wrong_method'
  | 'not_empirical'
  | 'duplicate'
  | 'not_accessible'
  | 'out_of_scope_date'
  | 'out_of_scope_venue'
  | 'other';

export interface VerificationRecord {
  identity: Identity;
  matchCategory: MatchCategory;
  integrity: IntegrityNotice[];
  linkStatus: LinkStatus;
  completeness: CheckCompleteness;
  /** Heuristic confidence in the match, 0-1. Not a probability. */
  confidence: number;
  provider: string;
  checkedAt: string;
  evidence: Record<string, unknown>;
}

export interface AcademicSource {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  type?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  citationCount?: number;
  citationProvider?: string;
  citationCollectedAt?: string;
  openAccessUrl?: string;
  citationContexts?: string[];
  sourceProvider: string;
}

export interface RetrievedCandidate {
  source: AcademicSource;
  provider: string;
  providerRank: number;
  payloadId?: string;
}

export interface RetrievalPayload {
  id: string;
  provider: string;
  query: string;
  url: string;
  fetchedAt: string;
  body: string;
}

export interface ProviderFailure {
  provider: string;
  reason: string;
  message: string;
}

export interface RetrievalResult {
  candidates: RetrievedCandidate[];
  payloads: RetrievalPayload[];
  failures: ProviderFailure[];
}

export interface ProviderReference {
  provider: string;
  rank: number;
  payloadId?: string;
}

export interface MergedCandidate {
  source: AcademicSource;
  providers: ProviderReference[];
}

export interface RankedSource {
  source: AcademicSource;
  verification: VerificationRecord;
  citability: Citability;
  rrfScore: number;
  rank: number;
  selected: boolean;
  providers: ProviderReference[];
}

export interface SearchOptions {
  limit: number;
  since?: number;
  until?: number;
  type?: string;
  types?: string[];
  openAccessOnly?: boolean;
  providers?: string[];
  mailto?: string;
  checkLinks?: boolean;
}

export interface SearchResult {
  runId: string;
  query: string;
  startedAt: string;
  finishedAt: string;
  retrieved: number;
  unique: number;
  selectedCount: number;
  citableCount: number;
  sources: RankedSource[];
  failures: ProviderFailure[];
  payloads: RetrievalPayload[];
}

export interface ReplaySnapshot {
  runId: string;
  query: string;
  sources: Array<{
    id: string;
    title: string;
    doi: string | null;
    year: number | null;
    providers: ProviderReference[];
    rrfScore: number;
    rank: number;
    selected: boolean;
    verification: {
      identity: Identity;
      matchCategory: MatchCategory;
      integrity: IntegrityNotice[];
      linkStatus: LinkStatus;
      completeness: 'complete' | 'incomplete';
      confidence: number;
    };
    citability: Citability;
  }>;
}

export interface ReplayResult {
  runId: string;
  ok: boolean;
  storedHash: string | null;
  replayedHash: string;
  sourceCount: number;
  payloadCount: number;
  problems: string[];
}
