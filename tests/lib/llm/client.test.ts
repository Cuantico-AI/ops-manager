import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteLLMClient } from '../../../src/lib/llm/client.js';
import { ExternalServiceError } from '../../../src/lib/errors.js';

describe('LiteLLMClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on non-200 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'error',
      }),
    );

    const client = new LiteLLMClient();
    await expect(
      client.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('returns parsed response on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: '1',
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        }),
      }),
    );

    const client = new LiteLLMClient();
    const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.choices[0]?.message.content).toBe('ok');
  });
});
