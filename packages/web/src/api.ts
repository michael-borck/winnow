export interface RunSummary {
  id: string;
  query: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface DraftSummary {
  id: string;
  runId: string | null;
  parentId: string | null;
  mode: string;
  writer: string;
  model: string | null;
  createdAt: string;
}

export interface StateResponse {
  project: { name: string; root: string };
  run: RunSummary | null;
  runs: RunSummary[];
  counts: null | {
    screening: Record<string, number>;
    evidence: Record<string, number>;
  };
  drafts: DraftSummary[];
  heldCount: number;
}

export interface SourceItem {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  citability: string;
  decision: string | null;
  relevance: string | null;
  reasonCode: string | null;
  reason: string | null;
  reviewer: string | null;
  filterFlags: string[];
  rank: number;
}

export interface SourcesResponse {
  run: RunSummary;
  counts: Record<string, number>;
  sources: SourceItem[];
}

export interface EvidenceRow {
  source: SourceItem;
  values: Record<string, string>;
  quotes: Record<string, string>;
  suggestions: Record<
    string,
    { value: string; confidence?: number; method?: string; rationale?: string }
  >;
  decision: string;
  relevance: string | null;
  rank: number;
}

export interface EvidenceResponse {
  run: RunSummary;
  fields: string[];
  counts: Record<string, number>;
  rows: EvidenceRow[];
}

export interface DraftDetail extends DraftSummary {
  markdown: string;
  structured: unknown;
}

export interface HeldSentence {
  id: string;
  text: string;
  type: string;
  section: string;
  support?: {
    label: string;
    confidence?: number;
    rationale?: string;
    model?: string;
  };
  override?: {
    action: 'restored' | 'dropped';
    reviewer: string;
    rationale?: string;
    at: string;
  };
}

export interface QueueResponse {
  draft: DraftSummary;
  held: HeldSentence[];
}

let sessionToken = '';

export async function initSession(): Promise<void> {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Cannot reach the local Winnow server');
  const data = (await response.json()) as { token: string };
  sessionToken = data.token;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-winnow-token': sessionToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
