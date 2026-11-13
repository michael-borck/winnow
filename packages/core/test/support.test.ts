import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvidenceBundle } from '../src/drafting/drafting.js';
import {
  checkDraft,
  generateTemplateDraft,
  renderDraftMarkdown,
} from '../src/drafting/drafting.js';
import { applySupportCheck, buildSupportMessages } from '../src/model/support.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function bundle(): EvidenceBundle {
  return {
    runId: 'run-support-1',
    query: 'retrieval',
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

function cleanDraft() {
  const evidence = bundle();
  return {
    bundle: evidence,
    draft: checkDraft(evidence, generateTemplateDraft(evidence)),
  };
}

async function mockSupport(payload: unknown): Promise<{ baseUrl: string }> {
  const server = createServer((request, res) => {
    request.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                typeof payload === 'string'
                  ? payload
                  : JSON.stringify(payload),
            },
          },
        ],
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

describe('support check', () => {
  it('keeps supported sentences', async () => {
    const { bundle: evidence, draft } = cleanDraft();
    const server = await mockSupport({
      label: 'supported',
      confidence: 0.9,
      rationale: 'The quote states the finding directly.',
    });

    const outcome = await applySupportCheck(draft, evidence, {
      baseUrl: server.baseUrl,
      model: 'support-mock',
    });

    expect(outcome.checked).toBe(1);
    expect(outcome.failed).toBe(0);
    const evidenceSentence = outcome.draft.sentences.find(
      (item) => item.type === 'evidence',
    );
    expect(evidenceSentence?.status).toBe('kept');
    expect(evidenceSentence?.support?.label).toBe('supported');
  });

  it('marks partial support and holds unsupported sentences', async () => {
    const { bundle: evidence, draft } = cleanDraft();

    const partialServer = await mockSupport({
      label: 'partial',
      confidence: 0.5,
      rationale: 'Only part of the sentence is supported.',
    });
    const partial = await applySupportCheck(draft, evidence, {
      baseUrl: partialServer.baseUrl,
      model: 'support-mock',
    });
    const partialSentence = partial.draft.sentences.find(
      (item) => item.type === 'evidence',
    );
    expect(partialSentence?.status).toBe('kept_marked');

    const unsupportedServer = await mockSupport({
      label: 'unsupported',
      confidence: 0.8,
      rationale: 'The quote does not support the claim.',
    });
    const unsupported = await applySupportCheck(draft, evidence, {
      baseUrl: unsupportedServer.baseUrl,
      model: 'support-mock',
    });
    const heldSentence = unsupported.draft.sentences.find(
      (item) => item.type === 'evidence',
    );
    expect(heldSentence?.status).toBe('held');

    const markdown = renderDraftMarkdown(evidence, unsupported.draft);
    expect(markdown).toContain('held for review');
    expect(markdown).toContain('unsupported');
  });

  it('leaves sentences in place when the support model fails', async () => {
    const { bundle: evidence, draft } = cleanDraft();
    const server = await mockSupport({ label: 'maybe' });

    const outcome = await applySupportCheck(draft, evidence, {
      baseUrl: server.baseUrl,
      model: 'support-mock',
    });

    expect(outcome.failed).toBe(1);
    expect(outcome.checked).toBe(0);
    const evidenceSentence = outcome.draft.sentences.find(
      (item) => item.type === 'evidence',
    );
    expect(evidenceSentence?.status).toBe('kept');
    expect(
      evidenceSentence?.checks.find((item) => item.check.startsWith('6.'))
        ?.message,
    ).toContain('not run');
  });

  it('sends the sentence and its quotes, not the whole corpus', () => {
    const { bundle: evidence, draft } = cleanDraft();
    const sentence = draft.sentences.find((item) => item.type === 'evidence')!;
    const messages = buildSupportMessages(sentence, [
      {
        sourceId: 'doi:10.1/a',
        quote: 'The results show that retrieval improves accuracy.',
      },
    ]);
    expect(messages[1]?.content).toContain('Retrieval improves accuracy.');
    expect(messages[1]?.content).toContain('The results show');
    expect(messages[1]?.content).not.toContain('SECRET');
  });
});
