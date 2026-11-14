import { useEffect, useState } from 'react';
import {
  apiGet,
  apiPost,
  initSession,
  type DraftDetail,
  type DraftSummary,
  type EvidenceResponse,
  type EvidenceRow,
  type HeldSentence,
  type QueueResponse,
  type ReviewResponse,
  type SourceItem,
  type SourcesResponse,
  type StateResponse,
} from './api';

type Tab = 'sources' | 'evidence' | 'drafts' | 'queue';

export default function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [tab, setTab] = useState<Tab>('sources');
  const [runId, setRunId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initSession();
        const data = await apiGet<StateResponse>('/api/state');
        if (!cancelled) {
          setState(data);
          setRunId(data.run?.id ?? '');
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh(id = runId): Promise<void> {
    try {
      const data = await apiGet<StateResponse>(
        `/api/state${id ? `?run=${encodeURIComponent(id)}` : ''}`,
      );
      setState(data);
      setRunId(data.run?.id ?? id);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!state) {
    return (
      <main className="center">
        {error ? <p className="error">{error}</p> : <p>Loading Winnow…</p>}
      </main>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark">W</span>
          <div>
            <h1>Winnow</h1>
            <p className="muted">{state.project.name}</p>
          </div>
        </div>
        <div className="run-picker">
          <label htmlFor="run">Run</label>
          <select
            id="run"
            value={runId}
            onChange={(event) => {
              setRunId(event.target.value);
              void refresh(event.target.value);
            }}
          >
            {state.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.query} · {run.id}
              </option>
            ))}
          </select>
        </div>
      </header>

      {state.run ? (
        <section className="summary">
          <div className="chips">
            <Chip label="Included" value={state.counts?.screening.included ?? 0} />
            <Chip label="Excluded" value={state.counts?.screening.excluded ?? 0} />
            <Chip label="Undecided" value={state.counts?.screening.undecided ?? 0} />
            <Chip label="Claims" value={state.counts?.evidence.claims ?? 0} />
            <Chip label="Held" value={state.heldCount} />
          </div>
          <p className="query">{state.run.query}</p>
        </section>
      ) : (
        <section className="empty">
          <h2>No completed run yet</h2>
          <p>Run `winnow search "topic"` in this project, then reload.</p>
        </section>
      )}

      {error ? <p className="error banner">{error}</p> : null}

      {state.run ? (
        <>
          <nav className="tabs">
            {(['sources', 'evidence', 'drafts', 'queue'] as const).map((item) => (
              <button
                key={item}
                className={tab === item ? 'tab active' : 'tab'}
                onClick={() => setTab(item)}
              >
                {label(item)}
              </button>
            ))}
          </nav>

          <main className="panel">
            {tab === 'sources' ? (
              <SourcesTab runId={runId} onChanged={() => refresh()} />
            ) : tab === 'evidence' ? (
              <EvidenceTab runId={runId} />
            ) : tab === 'drafts' ? (
              <DraftsTab runId={runId} />
            ) : (
              <QueueTab runId={runId} onChanged={() => refresh()} />
            )}
          </main>
        </>
      ) : null}
    </div>
  );
}

function SourcesTab({
  runId,
  onChanged,
}: {
  runId: string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<SourcesResponse>(`/api/sources?run=${encodeURIComponent(runId)}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  async function reload(): Promise<void> {
    try {
      setData(
        await apiGet<SourcesResponse>(
          `/api/sources?run=${encodeURIComponent(runId)}`,
        ),
      );
      setError(null);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading sources…</p>;
  if (!data.sources.length) return <p>No selected sources in this run.</p>;

  return (
    <div className="source-list">
      {data.sources.map((source) => (
        <SourceCard key={source.id} source={source} runId={runId} onSaved={reload} />
      ))}
    </div>
  );
}

function SourceCard({
  source,
  runId,
  onSaved,
}: {
  source: SourceItem;
  runId: string;
  onSaved: () => void;
}) {
  const [relevance, setRelevance] = useState(source.relevance ?? 'supporting');
  const [reason, setReason] = useState(source.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'include' | 'exclude' | 'maybe') {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/screen', {
        runId,
        sourceId: source.id,
        decision,
        relevance: decision === 'include' ? relevance : undefined,
        reason: decision === 'exclude' ? reason : undefined,
        reviewer: 'web',
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <div className="card-top">
        <div>
          <h3>{source.title}</h3>
          <p className="muted">
            {source.authors.slice(0, 4).join(', ')}
            {source.authors.length > 4 ? ' et al.' : ''} · {source.year ?? 'n.d.'}
            {source.venue ? ` · ${source.venue}` : ''}
          </p>
        </div>
        <div className="badges">
          <span className={`badge cit-${source.citability}`}>{source.citability}</span>
          <span className="badge">{source.decision ?? 'undecided'}</span>
        </div>
      </div>

      {source.doi ? (
        <a className="doi" href={`https://doi.org/${source.doi}`} target="_blank" rel="noreferrer">
          doi:{source.doi}
        </a>
      ) : null}

      {source.filterFlags.length ? (
        <p className="flags">flags: {source.filterFlags.join(', ')}</p>
      ) : null}

      {source.abstract ? (
        <details>
          <summary>Abstract</summary>
          <p>{source.abstract}</p>
        </details>
      ) : (
        <p className="muted">No abstract.</p>
      )}

      <div className="controls">
        <label>
          Priority
          <select value={relevance} onChange={(event) => setRelevance(event.target.value)}>
            <option value="core">core</option>
            <option value="supporting">supporting</option>
            <option value="peripheral">peripheral</option>
          </select>
        </label>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Exclusion reason (optional)"
        />
        <div className="buttons">
          <button disabled={busy} onClick={() => void decide('include')}>
            Include
          </button>
          <button disabled={busy} onClick={() => void decide('maybe')}>
            Maybe
          </button>
          <button disabled={busy} className="ghost" onClick={() => void decide('exclude')}>
            Exclude
          </button>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </article>
  );
}

function EvidenceTab({ runId }: { runId: string }) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<EvidenceResponse>(`/api/evidence?run=${encodeURIComponent(runId)}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading evidence…</p>;
  if (!data.rows.length) return <p>No human-confirmed includes yet.</p>;

  return (
    <div className="evidence-list">
      <p className="muted">
        {data.counts.included} included · {data.counts.extracted} extracted ·{' '}
        {data.counts.complete} complete
      </p>
      {data.rows.map((row) => (
        <EvidenceCard key={row.source.id} row={row} fields={data.fields} />
      ))}
    </div>
  );
}

function EvidenceCard({ row, fields }: { row: EvidenceRow; fields: string[] }) {
  return (
    <article className="card">
      <div className="card-top">
        <div>
          <h3>{row.source.title}</h3>
          <p className="muted">
            {row.source.authors.slice(0, 3).join(', ')} · {row.source.year ?? 'n.d.'}
          </p>
        </div>
        <span className="badge">{row.relevance ?? 'included'}</span>
      </div>
      <table className="evidence">
        <tbody>
          {fields.map((field) => {
            const value = row.values[field];
            const suggestion = row.suggestions[field];
            return (
              <tr key={field}>
                <th>{field}</th>
                <td>
                  {value ? (
                    <span>{value}</span>
                  ) : suggestion ? (
                    <span className="muted">
                      suggested: {suggestion.value}
                      {suggestion.confidence != null
                        ? ` (${suggestion.confidence.toFixed(2)})`
                        : ''}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  {row.quotes[field] ? (
                    <blockquote>{row.quotes[field]}</blockquote>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

function DraftsTab({ runId }: { runId: string }) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [parent, setParent] = useState<DraftDetail | null>(null);
  const [compare, setCompare] = useState(false);
  const [style, setStyle] = useState('apa');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ drafts: DraftSummary[] }>(
      `/api/drafts?run=${encodeURIComponent(runId)}`,
    )
      .then((result) => {
        if (cancelled) return;
        setDrafts(result.drafts);
        setSelected(result.drafts[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    setCompare(false);
    setParent(null);
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    apiGet<DraftDetail>(`/api/drafts/${encodeURIComponent(selected)}`)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function generate(): Promise<void> {
    setGenerating(true);
    setError(null);
    try {
      const result = await apiPost<ReviewResponse>('/api/review', {
        runId,
        style,
      });
      const list = await apiGet<{ drafts: DraftSummary[] }>(
        `/api/drafts?run=${encodeURIComponent(runId)}`,
      );
      setDrafts(list.drafts);
      setSelected(result.draftId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setGenerating(false);
    }
  }

  async function toggleCompare(): Promise<void> {
    if (!detail?.parentId) return;
    if (compare) {
      setCompare(false);
      return;
    }
    try {
      if (!parent || parent.id !== detail.parentId) {
        setParent(
          await apiGet<DraftDetail>(
            `/api/drafts/${encodeURIComponent(detail.parentId)}`,
          ),
        );
      }
      setCompare(true);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div>
      <div className="draft-toolbar">
        <button onClick={() => void generate()} disabled={generating}>
          {generating ? 'Generating…' : 'Generate template review'}
        </button>
        <label>
          Style
          <select value={style} onChange={(event) => setStyle(event.target.value)}>
            <option value="apa">APA</option>
            <option value="vancouver">Vancouver</option>
            <option value="harvard">Harvard</option>
          </select>
        </label>
        {error ? <span className="error">{error}</span> : null}
      </div>

      {!drafts.length ? (
        <p>No drafts yet. Generate one above.</p>
      ) : (
        <div className="draft-layout">
          <aside className="draft-list">
            {drafts.map((draft) => (
              <button
                key={draft.id}
                className={draft.id === selected ? 'draft-item active' : 'draft-item'}
                onClick={() => setSelected(draft.id)}
              >
                <strong>{draft.mode}</strong>
                <span>
                  {draft.writer}
                  {draft.model ? ` · ${draft.model}` : ''}
                </span>
                <small>{new Date(draft.createdAt).toLocaleString()}</small>
              </button>
            ))}
          </aside>
          <section className="draft-preview">
            {detail ? (
              <>
                <div className="draft-meta">
                  <span>{detail.id}</span>
                  {detail.parentId ? <span>parent: {detail.parentId}</span> : null}
                  {detail.parentId ? (
                    <button className="ghost" onClick={() => void toggleCompare()}>
                      {compare ? 'Hide parent' : 'Compare with parent'}
                    </button>
                  ) : null}
                </div>
                {compare && parent ? (
                  <div className="compare">
                    <div>
                      <h4>Parent {parent.id}</h4>
                      <pre>{parent.markdown}</pre>
                    </div>
                    <div>
                      <h4>Current {detail.id}</h4>
                      <pre>{detail.markdown}</pre>
                    </div>
                  </div>
                ) : (
                  <pre>{detail.markdown}</pre>
                )}
              </>
            ) : (
              <p>Select a draft.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function QueueTab({
  runId,
  onChanged,
}: {
  runId: string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setData(
        await apiGet<QueueResponse>(
          `/api/queue?run=${encodeURIComponent(runId)}`,
        ),
      );
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => {
    void load();
  }, [runId]);

  async function act(sentence: HeldSentence, action: 'restore' | 'drop') {
    if (!data) return;
    const rationale = window.prompt('Rationale (optional)') ?? undefined;
    try {
      await apiPost(`/api/queue/${action}`, {
        draftId: data.draft.id,
        sentenceId: sentence.id,
        reviewer: 'web',
        rationale,
      });
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading queue…</p>;

  return (
    <div className="queue">
      <p className="muted">
        Draft {data.draft.id} · {data.held.length} held
      </p>
      {!data.held.length ? <p>Nothing held.</p> : null}
      {data.held.map((sentence) => (
        <article className="card" key={sentence.id}>
          <p>{sentence.text}</p>
          {sentence.support ? (
            <p className="muted">
              support: {sentence.support.label}
              {sentence.support.rationale ? ` — ${sentence.support.rationale}` : ''}
            </p>
          ) : null}
          {sentence.override ? (
            <p className="muted">
              override: {sentence.override.action} by {sentence.override.reviewer}
            </p>
          ) : null}
          <div className="buttons">
            <button onClick={() => void act(sentence, 'restore')}>Restore</button>
            <button className="ghost" onClick={() => void act(sentence, 'drop')}>
              Accept hold
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="chip">
      <strong>{value}</strong> {label}
    </span>
  );
}

function label(tab: Tab): string {
  return tab === 'sources'
    ? 'Sources'
    : tab === 'evidence'
      ? 'Evidence'
      : tab === 'drafts'
        ? 'Drafts'
        : 'Queue';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
