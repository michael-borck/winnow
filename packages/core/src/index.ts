export type * from './types.js';

export {
  citability,
  isCitable,
  citabilityNote,
} from './verification/citability.js';
export { verifyDoi, verifySource, type VerifyOptions, type VerifiedDoi } from './verification/cite-sight-adapter.js';

export { retrieve, matchesType, normaliseSourceType, type RetrieveOptions } from './retrieval/index.js';
export { retrieveOpenAlex, abstractFromInvertedIndex } from './retrieval/openalex.js';
export { retrieveCrossref } from './retrieval/crossref.js';

export { dedupeCandidates } from './pipeline/dedupe.js';
export { rankCandidates } from './pipeline/rank.js';
export { searchLiterature } from './pipeline/search.js';

export {
  parseBrief,
  readBrief,
  briefId,
  formatBriefSummary,
  formatBriefJson,
  BriefError,
  type Brief,
  type BriefMode,
  type BriefFilters,
  type BriefCriteria,
  type BriefScope,
  type BriefWarning,
  type ParsedBrief,
} from './brief/brief.js';

export {
  initProject,
  findProject,
  openProject,
  projectPaths,
  SCHEMA_VERSION,
  type ProjectMeta,
  type OpenProject,
} from './project/project.js';
export {
  migrate,
  createRun,
  savePayload,
  saveRunSources,
  saveBrief,
  finishRun,
  getRun,
  getPayloads,
  loadRunSources,
  readPayload,
  recomputeCitability,
  type RunRow,
  type PayloadRow,
  type StoredSource,
} from './project/db.js';

export {
  buildSnapshot,
  hashSnapshot,
  replayRun,
  snapshotForRankedSources,
} from './replay.js';

export {
  formatTable,
  formatJson,
  formatSearchJson,
  formatCsv,
  formatBibtex,
  formatCsl,
  formatSourceList,
} from './export/format.js';

export { normaliseText, normaliseTitle, normaliseDoi } from './text/normalise.js';
export { sourceIdFor, firstAuthorSurname, stableHash, shortHash } from './text/ids.js';
export { mapLimit } from './util/async.js';
