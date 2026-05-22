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

  it('lists pipelines for a location', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          pipelines: [
            {
              id: 'pipe_1',
              name: 'Sales',
              locationId: 'loc_123',
              stages: [{ id: 'stage_1', name: 'New Lead' }],
            },
          ],
        }),
      }),
    );

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });
    const pipelines = await client.listPipelines('loc_123', 'pit_secret');

    expect(pipelines).toEqual([
      {
        id: 'pipe_1',
        name: 'Sales',
        locationId: 'loc_123',
        stages: [{ id: 'stage_1', name: 'New Lead' }],
      },
    ]);
  });

  it('paginates opportunity search results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          opportunities: [
            {
              id: 'opp_1',
              name: 'Opp 1',
              pipelineId: 'pipe_1',
              pipelineStageId: 'stage_1',
              status: 'open',
            },
          ],
          meta: { nextPage: 2 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          opportunities: [],
          meta: { nextPage: null },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });
    const opportunities = await client.listOpportunities('loc_123', 'pit_secret', {
      limit: 1,
      maxPages: 2,
    });

    expect(opportunities).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
