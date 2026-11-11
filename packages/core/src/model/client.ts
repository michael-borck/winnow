export interface ModelClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

export async function chatJson(
  options: ModelClientOptions,
  messages: ChatMessage[],
): Promise<unknown> {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 120_000;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey
          ? { Authorization: `Bearer ${options.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ModelError(
      `Cannot reach model at ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new ModelError(
      `Model HTTP ${response.status} at ${url}: ${text.slice(0, 500)}`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new ModelError(
      `Model response was not JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new ModelError('Model response had no message content');
  }

  return parseJsonContent(content);
}

export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ModelError(
      `Model did not return valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
