import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fetchCitationCandidates,
  hasCriticalContext,
  sampleCitationCandidates,
} from '../src/retrieval/semanticScholar.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function mockSemanticScholar(body: unknown): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

const response = {
  data: [
    {
      citingPaper: {
        paperId: 'p1',
        title: 'A failed replication',
        abstract: 'The replication fails to reproduce the effect.',
        authors: [{ name: 'Turing, Alan' }],
        year: 2025,
        externalIds: { DOI: '10.1/critical' },
        url: 'https://example.com/critical',
        citationCount: 5,
        venue: 'Journal of Tests',
      },
      contexts: ['Prior work fails to improve accuracy.'],
    },
    {
      citingPaper: {
        paperId: 'p2',
        title: 'A neutral follow-up',
        abstract: 'We build on prior work.',
        authors: [{ name: 'Hopper, Grace' }],
        year: 2024,
        externalIds: { DOI: '10.1/neutral' },
        url: 'https://example.com/neutral',
        citationCount: 500,
        venue: 'Journal of Tests',
      },
      contexts: ['We build on prior work.'],
    },
  ],
};

describe('Semantic Scholar citation chasing', () => {
  it('fetches citing papers with contexts and keeps the payload for replay', async () => {
    const baseUrl = await mockSemanticScholar(response);
    const result = await fetchCitationCandidates('10.1/source', {
      limit: 10,
      baseUrl,
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.source.doi).toBe('10.1/critical');
    expect(result.candidates[0]?.source.citationContexts).toEqual([
      'Prior work fails to improve accuracy.',
    ]);
    expect(result.payload.provider).toBe('semantic_scholar');
    expect(result.payload.body).toContain('A failed replication');
  });

  it('samples critical contexts before neutral, high-citation citers', async () => {
    const baseUrl = await mockSemanticScholar(response);
    const result = await fetchCitationCandidates('10.1/source', {
      limit: 10,
      baseUrl,
    });

    const sampled = sampleCitationCandidates(result.candidates, 1);
    expect(sampled).toHaveLength(1);
    expect(sampled[0]?.source.doi).toBe('10.1/critical');
    expect(sampled[0]?.providerRank).toBe(1);
  });

  it('recognises critical context phrases', () => {
    expect(hasCriticalContext('The approach fails to improve accuracy.')).toBe(
      true,
    );
    expect(hasCriticalContext('There is no evidence of benefit.')).toBe(true);
    expect(hasCriticalContext('We build on this work.')).toBe(false);
  });
});
