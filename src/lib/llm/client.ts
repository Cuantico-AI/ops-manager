import { ExternalServiceError } from '../errors.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model?: string;
  messages: Message[];
  tools?: Tool[];
}

export interface ChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string | null };
  }>;
}

const DEFAULT_MODEL = 'ops-claude-sonnet';

export class LiteLLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env.LITELLM_PROXY_URL ?? 'http://localhost:4000';
    this.apiKey = process.env.LITELLM_MASTER_KEY ?? '';
  }

  async chat(opts: ChatOptions): Promise<ChatResponse> {
    const model = opts.model ?? DEFAULT_MODEL;
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        tools: opts.tools,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new ExternalServiceError(
        `LiteLLM request failed: ${res.status} ${body}`,
        'LITELLM_ERROR',
      );
    }

    return (await res.json()) as ChatResponse;
  }
}

export const llmClient = new LiteLLMClient();
