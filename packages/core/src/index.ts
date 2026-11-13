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
  loadScreeningState,
  countScreening,
  importScreeningDecisions,
  parseScreeningDecisions,
  detectScreeningFormat,
  formatScreeningTable,
  formatScreeningJson,
  formatScreeningCsv,
  filterFlagsFor,
  ScreeningError,
  type ScreeningState,
  type ScreeningCounts,
  type ScreeningSummary,
  type ScreeningDecisionInput,
  type ScreeningImportResult,
  type ScreeningSuggestion,
  type ScreeningOptions,
} from './screening/screening.js';
export {
  suggestScreening,
  type ScreeningSuggestionDraft,
} from './screening/suggest.js';

export {
  DEFAULT_FIELDS,
  loadExtractionState,
  countExtraction,
  suggestExtraction,
  recordExtraction,
  importExtractionValues,
  parseExtractionValues,
  detectExtractionFormat,
  formatEvidenceTable,
  formatEvidenceJson,
  formatEvidenceCsv,
  ExtractionError,
  type ExtractionSuggestion,
  type ExtractionSuggestionDraft,
  type EvidenceRow,
  type ExtractionCounts,
  type ExtractionSummary,
  type ExtractionValueInput,
  type ExtractionImportResult,
} from './extraction/extraction.js';

export {
  buildEvidenceBundle,
  generateTemplateDraft,
  buildArgumentBundle,
  buildArgumentMap,
  generateArgumentDraft,
  checkDraft,
  renderDraftMarkdown,
  formatDraftJson,
  DraftError,
  type DraftSentenceType,
  type DraftStatus,
  type DraftQuote,
  type DraftCoverage,
  type DraftCheckResult,
  type DraftSentence,
  type SupportLabel,
  type SupportResult,
  type EvidenceClaim,
  type EvidenceSource,
  type EvidenceBundle,
  type StructuredDraft,
  type ArgumentNode,
  type ArgumentMap,
} from './drafting/drafting.js';

export {
  loadStanceState,
  countStances,
  suggestStance,
  recordStanceDecision,
  recordStanceSuggestionFor,
  importStances,
  parseStances,
  detectStanceFormat,
  formatStanceTable,
  formatStanceJson,
  formatStanceCsv,
  normaliseThesis,
  thesisHash,
  StanceError,
  type StanceSuggestion,
  type StanceSuggestionDraft,
  type StanceState,
  type StanceCounts,
  type StanceSummary,
  type StanceInput,
  type StanceImportResult,
} from './stance/stance.js';

export {
  chatJson,
  parseJsonContent,
  ModelError,
  type ModelClientOptions,
  type ChatMessage,
} from './model/client.js';
export {
  generateModelDraft,
  buildModelMessages,
  parseModelDraft,
  type ModelWriterOptions,
} from './model/writer.js';
export {
  applySupportCheck,
  buildSupportMessages,
  type SupportCheckOutcome,
} from './model/support.js';

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
  getLatestRun,
  getPayloads,
  loadRunSources,
  readPayload,
  recomputeCitability,
  getCurrentScreening,
  recordScreeningDecision,
  recordScreeningSuggestion,
  getLatestSuggestions,
  recordExtractionValue,
  recordExtractionSuggestion,
  getLatestExtractions,
  getLatestExtractionSuggestions,
  saveDraft,
  getDraft,
  recordStance,
  recordStanceSuggestion,
  getCurrentStances,
  getLatestStanceSuggestions,
  runSourceCounts,
  LATEST_SCHEMA_VERSION,
  type RunRow,
  type PayloadRow,
  type StoredSource,
  type ScreeningRow,
  type ScreeningSuggestionRow,
  type ExtractionRow,
  type ExtractionSuggestionRow,
  type DraftRow,
  type StanceRow,
  type StanceSuggestionRow,
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
