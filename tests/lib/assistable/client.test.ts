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

  it('treats a GHL conversation miss as connected OAuth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ ok: false, error: 'No GHL conversation found for contact' }),
          ),
      }),
    );

    const client = new AssistableClient({
      baseUrl: 'https://api.test',
      apiKey: 'assistable_secret',
      timeoutMs: 100,
    });
    const result = await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(result.status).toBe('connected');
    expect(result.message).toContain('No GHL conversation found for contact');
  });

  it('treats missing GHL access token as disconnected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ ok: false, error: 'No access token for location' })),
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

  it('maps HTTP 401 to auth-error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('Unauthorized'),
      }),
    );

    const client = new AssistableClient({
      baseUrl: 'https://api.test',
      apiKey: 'assistable_secret',
      timeoutMs: 100,
    });
    const result = await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(result.status).toBe('auth-error');
  });

  it('maps removed routes to unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ message: 'Route GET:/v2/get-contacts/loc_123 not found' }),
          ),
      }),
    );

    const client = new AssistableClient({
      baseUrl: 'https://api.test',
      apiKey: 'assistable_secret',
      timeoutMs: 100,
    });
    const result = await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(result.status).toBe('unreachable');
  });

  it('uses get-conversation with a probe contact id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ ok: false, error: 'No GHL conversation found for contact' }),
        ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new AssistableClient({
      baseUrl: 'https://api.test',
      apiKey: 'assistable_secret',
      timeoutMs: 100,
    });
    await client.checkLocationConnection({ locationId: 'loc_123' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.test/v2/get-conversation?location_id=loc_123&contact_id=ops-manager-health-probe',
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('assistable_secret');
  });
});
