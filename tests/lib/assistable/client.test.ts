import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistableClient } from '../../../src/lib/assistable/client.js';

describe('AssistableClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports auth-error when API key is missing', async () => {
    const client = new AssistableClient({ apiKey: '' });
    const result = await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(result.status).toBe('auth-error');
    expect(result.message).toContain('ASSISTABLE_API_KEY');
  });

  it.each([
    [200, 'OK', 'connected'],
    [401, 'Unauthorized', 'auth-error'],
    [403, 'Forbidden', 'disconnected'],
    [404, 'Not Found', 'not_found'],
    [503, 'Unavailable', 'unreachable'],
  ] as const)('maps HTTP %s to %s', async (status, statusText, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText,
        text: vi.fn().mockResolvedValue('test error'),
      }),
    );

    const client = new AssistableClient({
      baseUrl: 'https://api.test',
      apiKey: 'assistable_secret',
      timeoutMs: 100,
    });
    const result = await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(result.status).toBe(expected);
    if (status !== 200) {
      expect(result.message).toBe('test error');
    }
  });

  it('does not put the API key into the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new AssistableClient({
      baseUrl: 'https://api.test',
      apiKey: 'assistable_secret',
      timeoutMs: 100,
    });
    await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.test/v2/get-contacts/loc_123');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('assistable_secret');
  });

  it('treats CRM connection errors as disconnected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue('No Active CRM Connection for this location'),
      }),
    );

    const client = new AssistableClient({
      baseUrl: 'https://api.test',
      apiKey: 'assistable_secret',
      timeoutMs: 100,
    });
    const result = await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(result.status).toBe('disconnected');
  });
});
