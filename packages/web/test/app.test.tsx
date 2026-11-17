// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from '../src/App';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const state = {
  project: { name: 'demo', root: '/tmp/demo' },
  run: {
    id: 'run-1',
    query: 'retrieval',
    status: 'ok',
    startedAt: '2026-11-16T00:00:00.000Z',
    finishedAt: '2026-11-16T00:00:01.000Z',
  },
  runs: [
    {
      id: 'run-1',
      query: 'retrieval',
      status: 'ok',
      startedAt: '2026-11-16T00:00:00.000Z',
      finishedAt: '2026-11-16T00:00:01.000Z',
    },
  ],
  counts: {
    screening: {
      identified: 1,
      deduplicated: 1,
      screened: 1,
      included: 1,
      excluded: 0,
      maybe: 0,
      undecided: 0,
      filteredOut: 0,
    },
    evidence: {
      included: 1,
      extracted: 1,
      complete: 0,
      missing: 1,
      claims: 1,
    },
  },
  drafts: [],
  heldCount: 0,
};

const emptyState = {
  project: { name: 'demo', root: '/tmp/demo' },
  run: null,
  runs: [],
  counts: null,
  drafts: [],
  heldCount: 0,
};

const evidence = {
  run: {
    id: 'run-1',
    query: 'retrieval',
    status: 'ok',
    startedAt: '2026-11-16T00:00:00.000Z',
    finishedAt: '2026-11-16T00:00:01.000Z',
  },
  fields: ['finding', 'sample'],
  counts: { included: 1, extracted: 1, complete: 0, missing: 1 },
  rows: [
    {
      source: {
        id: 'doi:10.1/a',
        title: 'A study',
        authors: ['Ada Lovelace'],
        year: 2024,
        venue: 'Journal',
        doi: '10.1/a',
        url: null,
        abstract: 'Abstract',
        citability: 'citable',
        decision: 'include',
        relevance: 'core',
        reasonCode: null,
        reason: null,
        reviewer: 'ada',
        rank: 1,
        filterFlags: [],
      },
      values: { finding: 'Retrieval improves accuracy.' },
      quotes: { finding: 'The results show that retrieval improves accuracy.' },
      suggestions: {},
      decision: 'include',
      relevance: 'core',
      rank: 1,
    },
  ],
};

function mockFetch(
  stateOverride: typeof state | typeof emptyState = state,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/session') return json({ token: 'token-1', project: 'demo' });
    if (url.startsWith('/api/state')) return json(stateOverride);
    if (url.startsWith('/api/sources')) {
      return json({
        run: stateOverride.run,
        counts: stateOverride.counts?.screening ?? {},
        sources: [
          {
            id: 'doi:10.1/a',
            title: 'A study',
            authors: ['Ada Lovelace'],
            year: 2024,
            venue: 'Journal',
            doi: '10.1/a',
            abstract: 'Abstract',
            citability: 'citable',
            decision: 'include',
            relevance: 'core',
            reasonCode: null,
            reason: null,
            reviewer: 'ada',
            filterFlags: [],
            rank: 1,
          },
        ],
      });
    }
    if (url.startsWith('/api/evidence')) {
      if (init?.method === 'POST') return json({ ok: true });
      return json(evidence);
    }
    return json({});
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('renders the sidebar and navigation', async () => {
    vi.stubGlobal('fetch', mockFetch());

    render(<App />);

    expect(await screen.findByText('Winnow')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evidence' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drafts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About' })).toBeInTheDocument();
  });

  it('shows the About panel without a completed run', async () => {
    vi.stubGlobal('fetch', mockFetch(emptyState));
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'About' }));

    expect(await screen.findByText('About Winnow')).toBeInTheDocument();
    expect(screen.getByText(/local-first literature search/)).toBeInTheDocument();
    expect(screen.getByText(/There is no telemetry/)).toBeInTheDocument();
  });

  it('edits confirmed evidence and posts the update', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Evidence' }));

    const edit = await screen.findByRole('button', { name: 'Edit' });
    await user.click(edit);

    const finding = await screen.findByLabelText('finding value');
    await user.clear(finding);
    await user.type(finding, 'Retrieval improves accuracy in a controlled study.');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === '/api/evidence' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body.field).toBe('finding');
      expect(body.value).toBe(
        'Retrieval improves accuracy in a controlled study.',
      );
      expect(body.sourceId).toBe('doi:10.1/a');
    });
  });
});