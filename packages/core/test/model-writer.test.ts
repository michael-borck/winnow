import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvidenceBundle } from '../src/drafting/drafting.js';
import { checkDraft } from '../src/drafting/drafting.js';
import {
  buildModelMessages,
  generateModelDraft,
  parseModelDraft,
} from '../src/model/writer.js';
import { ModelError } from '../src/model/client.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function bundle(): EvidenceBundle {
  return {
    runId: 'run-model-1',
    query: 'retrieval',
    fields: ['finding'],
    counts: { included: 1, withEvidence: 1, claims: 1 },
    claims: [
      {
        id: 'claim-1',
        sourceId: 'doi:10.1/a',
        sourceTitle: 'A study',
        authors: ['Lovelace, Ada'],
        year: 2024,
        citability: 'citable',
        integrity: ['none_found'],
        field: 'finding',
        value: 'Retrieval improves accuracy.',
        quote: 'The results show that retrieval improves accuracy.',
      },
    ],
    sources: [
      {
        id: 'doi:10.1/a',
        title: 'A study',
        authors: ['Lovelace, Ada'],
        year: 2024,
        citability: 'citable',
        integrity: ['none_found'],
        rank: 1,
        fields: ['finding'],
        abstract: 'The results show that retrieval improves accuracy.',
      },
    ],
    unquoted: [],
  };
}

async function mockModel(content: unknown): Promise<{
  baseUrl: string;
  lastRequest: () => unknown;
}> {
  let lastRequest: unknown;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      lastRequest = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  typeof content === 'string'
                    ? content
                    : JSON.stringify(content),
              },
            },
          ],
        }),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    lastRequest: () => lastRequest,
  };
}

const validDraft = {
  title: 'A model review',
  sentences: [
    {
      text: 'This review uses confirmed evidence.',
      type: 'framing',
      section: 'Overview',
      citations: [],
      quotes: [],
    },
    {
      text: 'The review includes 1 source.',
      type: 'coverage',
      section: 'Overview',
      citations: [],
      quotes: [],
      coverage: { included: 1 },
    },
    {
      text: '{{cite:doi:10.1/a}} The results show that retrieval improves accuracy.',
      type: 'evidence',
      section: 'Finding',
      citations: ['doi:10.1/a'],
      quotes: [
        {
          sourceId: 'doi:10.1/a',
          quote: 'The results show that retrieval improves accuracy.',
        },
      ],
    },
  ],
};

describe('model writer', () => {
  it('sends only the bundle and parses a valid draft', async () => {
    const model = await mockModel(validDraft);
    const evidence = bundle();
    const draft = await generateModelDraft(evidence, {
      baseUrl: model.baseUrl,
      model: 'mock-model',
      mode: 'review',
    });

    expect(draft.writer).toBe('model');
    expect(draft.model).toBe('mock-model');
    expect(draft.title).toBe('A model review');
    expect(draft.sentences).toHaveLength(3);

    const request = model.lastRequest() as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(request.model).toBe('mock-model');
    const user = request.messages.find((message) => message.role === 'user');
    expect(user?.content).toContain('claim-1');
    expect(user?.content).toContain('doi:10.1/a');
    expect(user?.content).toContain('Retrieval improves accuracy.');
    expect(user?.content).not.toContain('SECRET');

    const checked = checkDraft(evidence, draft);
    expect(checked.sentences.every((item) => item.status === 'kept')).toBe(true);
  });

  it('rejects malformed JSON and unknown sentence types', async () => {
    const badJson = await mockModel('not json');
    await expect(
      generateModelDraft(bundle(), {
        baseUrl: badJson.baseUrl,
        model: 'mock',
        mode: 'review',
      }),
    ).rejects.toBeInstanceOf(ModelError);

    const badType = await mockModel({
      title: 'Bad',
      sentences: [
        {
          text: 'A sentence.',
          type: 'opinion',
          section: 'X',
          citations: [],
          quotes: [],
        },
      ],
    });
    await expect(
      generateModelDraft(bundle(), {
        baseUrl: badType.baseUrl,
        model: 'mock',
        mode: 'review',
      }),
    ).rejects.toThrow('invalid type');
  });

  it('drops a model sentence whose quote is not in the source text', () => {
    const draft = parseModelDraft(
      {
        title: 'Bad quote',
        sentences: [
          {
            text: '{{cite:doi:10.1/a}} A fabricated quotation.',
            type: 'evidence',
            section: 'Finding',
            citations: ['doi:10.1/a'],
            quotes: [
              {
                sourceId: 'doi:10.1/a',
                quote: 'This sentence is not in the abstract.',
              },
            ],
          },
        ],
      },
      bundle(),
      { baseUrl: 'http://localhost:1', model: 'mock', mode: 'review' },
    );

    const checked = checkDraft(bundle(), draft).sentences[0]!;
    expect(checked.status).toBe('dropped');
    expect(checked.checks.find((item) => item.check.startsWith('3.'))?.ok).toBe(
      false,
    );
  });

  it('includes stance counts in an argument prompt', () => {
    const evidence = bundle();
    evidence.sources[0]!.stance = 'opposes';
    evidence.sources[0]!.stanceConfirmed = true;
    const messages = buildModelMessages(evidence, {
      baseUrl: 'http://localhost:1',
      model: 'mock',
      mode: 'argue',
      thesis: 'Retrieval improves accuracy.',
    });
    expect(messages[1]?.content).toContain('"opposes": 1');
    expect(messages[1]?.content).toContain('Counter-evidence');
  });
});
