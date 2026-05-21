import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhlClient } from '../../../src/lib/ghl/client.js';

describe('GhlClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [200, 'OK', 'valid'],
    [401, 'Unauthorized', 'invalid'],
    [403, 'Forbidden', 'forbidden'],
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

    const client = new GhlClient({
      baseUrl: 'https://services.test',
      timeoutMs: 100,
    });
    const result = await client.validatePitToken({
      locationId: 'loc_123',
      pitToken: 'pit_secret',
    });

    expect(result.status).toBe(expected);
    if (status !== 200) {
      expect(result.message).toBe('test error');
    }
  });

  it('does not put the token into the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new GhlClient({
      baseUrl: 'https://services.test',
      timeoutMs: 100,
    });
    await client.validatePitToken({
      locationId: 'loc_123',
      pitToken: 'pit_secret',
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://services.test/locations/loc_123');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('pit_secret');
  });
});
