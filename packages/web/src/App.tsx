import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
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
  type SearchFailure,
  type SearchResponse,
  type SourceItem,
  type SourcesResponse,
  type StateResponse,
} from './api';
import {
  loadSearchSettings,
  saveSearchSettings,
  type SearchSettings,
} from './lib/search-settings';

type Tab = 'search' | 'sources' | 'evidence' | 'drafts' | 'queue' | 'about';

export default function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [tab, setTab] = useState<Tab>('search');
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
          setTab(data.run ? 'sources' : 'search');
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
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status" aria-live="polite">
            Loading Winnow…
          </p>
        )}
      </main>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className="sidebar">
        <div className="brand">
          <span className="mark">W</span>
          <div>
            <h1>Winnow</h1>
            <p className="muted">Local literature review</p>
          </div>
        </div>

        <div className="project">
          <div className="name">{state.project.name}</div>
          <div className="meta">
            {state.run
              ? `${state.run.query} · ${state.run.id}`
              : 'No completed run'}
          </div>
        </div>

        <nav className="nav" aria-label="Sections">
          {(['search', 'sources', 'evidence', 'drafts', 'queue', 'about'] as const).map((item) => (
            <button
              key={item}
              className={tab === item ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(item)}
              aria-current={tab === item ? 'page' : undefined}
            >
              {label(item)}
            </button>
          ))}
        </nav>

        <footer className="footer">v1.2.0 · local</footer>
      </aside>

      <div className="main" id="main" tabIndex={-1}>
        <header className="top">
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

        {state.run && tab !== 'about' && tab !== 'search' ? (
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
        ) : null}

        {!state.run && tab !== 'about' && tab !== 'search' ? (
          <section className="empty">
            <h2>No completed run yet</h2>
            <p>Use the Search tab, or run `winnow search "topic"` in this project.</p>
          </section>
        ) : null}

        {error ? (
          <p className="error banner" role="alert">
            {error}
          </p>
        ) : null}

        {tab === 'search' ? (
          <main className="panel">
            <SearchTab
              onSearch={(runId) => {
                setTab('sources');
                void refresh(runId);
              }}
            />
          </main>
        ) : state.run || tab === 'about' ? (
          <main className="panel">
            {tab === 'about' ? (
              <AboutTab />
            ) : tab === 'sources' ? (
              <SourcesTab runId={runId} onChanged={() => refresh()} />
            ) : tab === 'evidence' ? (
              <EvidenceTab runId={runId} />
            ) : tab === 'drafts' ? (
              <DraftsTab runId={runId} />
            ) : (
              <QueueTab runId={runId} onChanged={() => refresh()} />
            )}
          </main>
        ) : null}
      </div>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="about">
      <h2>About Winnow</h2>
      <p>
        Winnow is a local-first literature search and review tool. It finds
        sources, verifies them, and helps you build a grounded review draft
        without sending your library to a cloud service.
      </p>

      <h3>How it works</h3>
      <p>
        Winnow follows a review pipeline: brief, search, verify, screen,
        extract, stance, review, argue, counter, queue. Each stage keeps machine
        suggestions separate from human decisions.
      </p>

      <h3>Privacy</h3>
      <ul>
        <li>Your library, notes, drafts, and payloads live in a local SQLite file.</li>
        <li>Network access is limited to scholarly APIs and the model endpoint you configure.</li>
        <li>A local model is the default. A cloud model is optional and never part of the correctness path.</li>
        <li>API keys come from the environment and are never written to the database, logs, or exports.</li>
        <li>There is no telemetry, analytics, or cloud sync.</li>
      </ul>

      <h3>Limits</h3>
      <p>
        Winnow targets structured narrative and scoping reviews. It is not a
        systematic-review engine. The result set is relevance-ranked, not
        exhaustive, and the flow counts are labelled "PRISMA-inspired", never
        PRISMA-compliant.
      </p>
      <p>
        The Weigh stage is specified but deferred. Winnow does not generate
        references. It exports only records that pass the citability rule.
      </p>

      <h3>Documentation</h3>
      <ul>
        <li>
          <a href="https://github.com/michael-borck/winnow/blob/main/SPEC.md" target="_blank" rel="noreferrer">
            Specification
          </a>
        </li>
        <li>
          <a href="https://github.com/michael-borck/winnow/blob/main/docs/method.md" target="_blank" rel="noreferrer">
            Method
          </a>
        </li>
        <li>
          <a href="https://github.com/michael-borck/winnow/tree/main/docs/adr" target="_blank" rel="noreferrer">
            Architecture decisions
          </a>
        </li>
        <li>
          <a href="https://winnow.borck.education" target="_blank" rel="noreferrer">
            Website
          </a>
        </li>
      </ul>

      <p className="small muted">Winnow v1.2.0 · MIT licensed</p>
    </div>
  );
}

function SearchTab({
  onSearch,
}: {
  onSearch: (runId: string) => void;
}) {
  const [topic, setTopic] = useState('');
  const [limit, setLimit] = useState('40');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [greyLiterature, setGreyLiterature] = useState(false);
  const [checkLinks, setCheckLinks] = useState(false);
  const [settings, setSettings] = useState<SearchSettings>(loadSearchSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<SearchFailure[]>([]);

  useEffect(() => {
    saveSearchSettings(settings);
  }, [settings]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed) {
      setError('Enter a topic to search for.');
      return;
    }

    setBusy(true);
    setError(null);
    setFailures([]);
    try {
      const response = await apiPost<SearchResponse>('/api/search', {
        topic: trimmed,
        limit: Number(limit) || 40,
        since: since ? Number(since) : undefined,
        until: until ? Number(until) : undefined,
        greyLiterature,
        checkLinks,
        braveApiKey: settings.braveApiKey || undefined,
        serperApiKey: settings.serperApiKey || undefined,
        searxngUrl: settings.searxngUrl || undefined,
        searchFallbackEnabled: settings.fallbackEnabled,
        searchFallbackOrder: settings.fallbackOrder,
      });
      setFailures([...(response.failures ?? []), ...(response.payloadFailures ?? [])]);
      onSearch(response.runId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="search-form">
      <div>
        <h2>New search</h2>
        <p className="muted">
          OpenAlex and Crossref run by default. Add grey literature to include
          web results from Brave, Serper, or SearXNG.
        </p>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        <label>
          Topic or question
          <input
            value={topic}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTopic(event.target.value)}
            placeholder="e.g. feedback literacy in higher education"
            required
          />
        </label>

        <div className="row">
          <label>
            Limit
            <input
              type="number"
              min="1"
              max="100"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
          <label>
            Since
            <input
              type="number"
              min="1900"
              max="2100"
              value={since}
              onChange={(event) => setSince(event.target.value)}
            />
          </label>
          <label>
            Until
            <input
              type="number"
              min="1900"
              max="2100"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={greyLiterature}
            onChange={(event) => setGreyLiterature(event.target.checked)}
          />{' '}
          Include grey literature (web search)
        </label>
        {greyLiterature ? (
          <p className="muted">
            Web results are not database-attested and stay not citable until
            attested. They are useful for discovery and screening.
          </p>
        ) : null}

        <label className="check">
          <input
            type="checkbox"
            checked={checkLinks}
            onChange={(event) => setCheckLinks(event.target.checked)}
          />{' '}
          Check landing-page links (slower)
        </label>

        <details className="search-settings">
          <summary>Search provider settings</summary>
          <p className="muted">
            Keys stay in this tab and are sent only to the local server for this
            search. The CLI reads BRAVE_API_KEY, SERPER_API_KEY and SEARXNG_URL
            from the environment.
          </p>
          <div className="row">
            <label>
              Brave API key
              <input
                type="password"
                autoComplete="off"
                value={settings.braveApiKey}
                onChange={(event) =>
                  setSettings({ ...settings, braveApiKey: event.target.value })
                }
              />
            </label>
            <label>
              Serper API key
              <input
                type="password"
                autoComplete="off"
                value={settings.serperApiKey}
                onChange={(event) =>
                  setSettings({ ...settings, serperApiKey: event.target.value })
                }
              />
            </label>
          </div>
          <label>
            SearXNG URL
            <input
              value={settings.searxngUrl}
              onChange={(event) =>
                setSettings({ ...settings, searxngUrl: event.target.value })
              }
              placeholder="http://localhost:8080"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.fallbackEnabled}
              onChange={(event) =>
                setSettings({ ...settings, fallbackEnabled: event.target.checked })
              }
            />{' '}
            Fall back to the next configured provider
          </label>
          <label>
            Fallback order
            <input
              value={settings.fallbackOrder}
              disabled={!settings.fallbackEnabled}
              onChange={(event) =>
                setSettings({ ...settings, fallbackOrder: event.target.value })
              }
              placeholder="brave,serper,searxng"
            />
          </label>
          <p className="muted">
            Brave: $5 free credit each month, then $5 per 1,000 requests. Serper:
            2,500 free queries, then prepaid credits. SearXNG is free to
            self-host but can rate-limit. Queries leave this device and go to the
            selected provider.
          </p>
        </details>

        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Searching…' : 'Run search'}
          </button>
          {error ? (
            <span className="error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </form>

      {failures.length ? (
        <div className="card">
          <h3>Partial search</h3>
          {failures.map((failure) => (
            <p className="muted" key={`${failure.provider}-${failure.message}`}>
              {failure.provider}: {failure.message}
            </p>
          ))}
        </div>
      ) : null}
    </section>
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

  if (error) return <p className="error" role="alert">{error}</p>;
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
          {source.sourceProvider === 'web' ? (
            <span className="badge">grey literature</span>
          ) : null}
          <span className={`badge cit-${source.citability}`}>{source.citability}</span>
          <span className="badge">{source.decision ?? 'undecided'}</span>
        </div>
      </div>

      {source.doi ? (
        <a className="doi" href={`https://doi.org/${source.doi}`} target="_blank" rel="noreferrer">
          doi:{source.doi}
        </a>
      ) : source.url ? (
        <a className="doi" href={source.url} target="_blank" rel="noreferrer">
          {source.url}
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
      {error ? <p className="error" role="alert">{error}</p> : null}
    </article>
  );
}

function EvidenceTab({ runId }: { runId: string }) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const result = await apiGet<EvidenceResponse>(
        `/api/evidence?run=${encodeURIComponent(runId)}`,
      );
      setData(result);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiGet<EvidenceResponse>(`/api/evidence?run=${encodeURIComponent(runId)}`)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p role="status" aria-live="polite">Loading evidence…</p>;
  if (!data.rows.length) return <p>No human-confirmed includes yet.</p>;

  return (
    <div className="evidence-list">
      <p className="muted">
        {data.counts.included} included · {data.counts.extracted} extracted ·{' '}
        {data.counts.complete} complete
      </p>
      {data.rows.map((row) => (
        <EvidenceCard
          key={row.source.id}
          row={row}
          fields={data.fields}
          runId={runId}
          onChanged={reload}
        />
      ))}
    </div>
  );
}

function EvidenceCard({
  row,
  fields,
  runId,
  onChanged,
}: {
  row: EvidenceRow;
  fields: string[];
  runId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(): void {
    setValues({ ...row.values });
    setQuotes({ ...row.quotes });
    setError(null);
    setEditing(true);
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      for (const field of fields) {
        const value = values[field]?.trim();
        if (!value) continue;
        await apiPost('/api/evidence', {
          runId,
          sourceId: row.source.id,
          field,
          value,
          ...(quotes[field]?.trim() ? { quote: quotes[field].trim() } : {}),
          reviewer: 'web',
        });
      }
      setEditing(false);
      await onChanged();
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
          <h3>{row.source.title}</h3>
          <p className="muted">
            {row.source.authors.slice(0, 3).join(', ')} · {row.source.year ?? 'n.d.'}
          </p>
        </div>
        <div className="buttons">
          <button className="ghost" onClick={startEdit} disabled={busy}>
            Edit
          </button>
          <span className="badge">{row.relevance ?? 'included'}</span>
        </div>
      </div>

      {editing ? (
        <form className="evidence-edit" onSubmit={save}>
          {fields.map((field) => (
            <label key={field}>
              <span>{field}</span>
              <input
                value={values[field] ?? ''}
                aria-label={`${field} value`}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
              />
              {field !== 'quote' ? (
                <input
                  className="quote"
                  value={quotes[field] ?? ''}
                  aria-label={`${field} quote`}
                  onChange={(event) =>
                    setQuotes((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  placeholder="quote (optional)"
                />
              ) : null}
            </label>
          ))}
          <div className="buttons">
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </form>
      ) : (
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
      )}

      {!editing && error ? (
        <p className="error" role="alert">{error}</p>
      ) : null}
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
  const [writer, setWriter] = useState('template');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [remoteConsent, setRemoteConsent] = useState(false);
  const [support, setSupport] = useState(false);
  const [cslXml, setCslXml] = useState<string | null>(null);
  const [cslName, setCslName] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remoteModel = !isLocalBaseUrl(baseUrl);

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
    if (writer === 'model' && !model.trim()) {
      setError('Model name is required for the model writer');
      return;
    }
    setGenerating(true);
    setError(null);
    setWarning(null);
    try {
      const result = await apiPost<ReviewResponse>('/api/review', {
        runId,
        style,
        writer,
        ...(writer === 'model'
          ? {
              model: model.trim(),
              baseUrl,
              consent: remoteModel ? remoteConsent : false,
            }
          : {}),
        support: writer === 'model' && support,
        ...(cslXml ? { csl: cslXml } : {}),
      });
      const list = await apiGet<{ drafts: DraftSummary[] }>(
        `/api/drafts?run=${encodeURIComponent(runId)}`,
      );
      setDrafts(list.drafts);
      setSelected(result.draftId);
      if (result.warning) setWarning(result.warning);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setGenerating(false);
    }
  }

  async function loadCsl(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      setCslXml(null);
      setCslName(null);
      return;
    }
    setCslXml(await file.text());
    setCslName(file.name);
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
        <button
          onClick={() => void generate()}
          aria-busy={generating}
          disabled={
            generating ||
            (writer === 'model' &&
              (!model.trim() || (remoteModel && !remoteConsent)))
          }
        >
          {generating ? 'Generating…' : 'Generate review'}
        </button>
        <label>
          Writer
          <select value={writer} onChange={(event) => setWriter(event.target.value)}>
            <option value="template">Template</option>
            <option value="model">Model</option>
          </select>
        </label>
        {writer === 'model' ? (
          <>
            <label>
              Model
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="qwen3:8b"
              />
            </label>
            <label>
              Base URL
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
            {remoteModel ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={remoteConsent}
                  onChange={(event) => setRemoteConsent(event.target.checked)}
                />
                I understand the evidence bundle will leave this machine
              </label>
            ) : null}
            <label className="check">
              <input
                type="checkbox"
                checked={support}
                onChange={(event) => setSupport(event.target.checked)}
              />
              Support pass
            </label>
          </>
        ) : null}
        <label>
          Style
          <select
            value={style}
            disabled={Boolean(cslXml)}
            onChange={(event) => setStyle(event.target.value)}
          >
            <option value="apa">APA</option>
            <option value="vancouver">Vancouver</option>
            <option value="harvard">Harvard</option>
          </select>
        </label>
        <label>
          CSL
          <input type="file" accept=".csl,.xml" onChange={(event) => void loadCsl(event)} />
        </label>
        {cslName ? <span className="muted">custom: {cslName}</span> : null}
        {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
      </div>

      {writer === 'model' ? (
        <p className="muted small">
          API keys come from the server environment. The evidence bundle leaves
          this machine if the base URL is not localhost.
        </p>
      ) : null}
      {warning ? <p className="warning">{warning}</p> : null}

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
                  <div className="buttons">
                    <button className="ghost" onClick={() => void copyDraft(detail)}>
                      Copy Markdown
                    </button>
                    <button className="ghost" onClick={() => downloadDraft(detail)}>
                      Download .md
                    </button>
                    {detail.parentId ? (
                      <button className="ghost" onClick={() => void toggleCompare()}>
                        {compare ? 'Hide parent' : 'Compare with parent'}
                      </button>
                    ) : null}
                  </div>
                </div>
                {compare && parent ? (
                  <div className="compare">
                    <div>
                      <h4>Parent {parent.id}</h4>
                      <pre tabIndex={0} aria-label="Draft preview">{parent.markdown}</pre>
                    </div>
                    <div>
                      <h4>Current {detail.id}</h4>
                      <pre tabIndex={0} aria-label="Draft preview">{detail.markdown}</pre>
                    </div>
                  </div>
                ) : (
                  <pre tabIndex={0} aria-label="Draft preview">{detail.markdown}</pre>
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

  if (error) return <p className="error" role="alert">{error}</p>;
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
  return tab === 'search'
    ? 'Search'
    : tab === 'sources'
    ? 'Sources'
    : tab === 'evidence'
      ? 'Evidence'
      : tab === 'drafts'
        ? 'Drafts'
        : tab === 'queue'
          ? 'Queue'
          : 'About';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLocalBaseUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, '');
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

async function copyDraft(detail: DraftDetail): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error('Clipboard is not available in this browser');
  }
  await navigator.clipboard.writeText(detail.markdown);
}

function downloadDraft(detail: DraftDetail): void {
  const blob = new Blob([detail.markdown], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${detail.id}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
