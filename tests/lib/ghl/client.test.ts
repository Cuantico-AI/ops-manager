import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhlClient } from '../../../src/lib/ghl/client.js';
import { ExternalServiceError } from '../../../src/lib/errors.js';

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

  it('lists workflows for a location', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          workflows: [
            {
              id: 'wf_1',
              name: 'Welcome Sequence',
              status: 'published',
              locationId: 'loc_123',
              version: 2,
            },
          ],
        }),
      }),
    );

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });
    const workflows = await client.listWorkflows('loc_123', 'pit_secret');

    expect(workflows).toEqual([
      {
        id: 'wf_1',
        name: 'Welcome Sequence',
        status: 'published',
        locationId: 'loc_123',
        version: 2,
      },
    ]);
  });

  it('lists custom fields for a location', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          customFields: [
            {
              id: 'cf_1',
              name: 'Lead Source',
              fieldKey: 'contact.lead_source',
              dataType: 'TEXT',
              model: 'contact',
            },
          ],
        }),
      }),
    );

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });
    const customFields = await client.listCustomFields('loc_123', 'pit_secret');

    expect(customFields).toEqual([
      {
        id: 'cf_1',
        name: 'Lead Source',
        fieldKey: 'contact.lead_source',
        dataType: 'TEXT',
        model: 'contact',
      },
    ]);
  });

  it('parses a custom value from the GET response envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            customValue: {
              id: 'cv_1',
              name: 'robot_webhook',
              value: 'https://hooks.test/abc',
              locationId: 'loc_123',
            },
          }),
        ),
      }),
    );

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });
    const customValue = await client.getCustomValue('loc_123', 'cv_1', 'pit_secret');

    expect(customValue).toEqual({
      id: 'cv_1',
      name: 'robot_webhook',
      value: 'https://hooks.test/abc',
      locationId: 'loc_123',
    });
  });

  it('parses a custom value whose envelope has no value key (never-set field)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            customValue: {
              id: 'cv_1',
              name: 'Robot Webhook',
              fieldKey: 'custom_values.robot_webhook',
              locationId: 'loc_123',
              documentType: 'field',
              parentId: 'parent_1',
            },
          }),
        ),
      }),
    );

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });
    const customValue = await client.getCustomValue('loc_123', 'cv_1', 'pit_secret');

    expect(customValue).toEqual({
      id: 'cv_1',
      name: 'Robot Webhook',
      value: '',
      locationId: 'loc_123',
    });
  });

  it('captures the raw body when a custom value response has an unexpected shape', async () => {
    const rawBody = JSON.stringify({ customValues: [{ id: 'cv_1', name: 'robot_webhook' }] });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(rawBody),
      }),
    );

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });

    const err = await client
      .getCustomValue('loc_123', 'cv_1', 'pit_secret')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ExternalServiceError);
    expect((err as ExternalServiceError).code).toBe('GHL_API_ERROR');
    expect((err as ExternalServiceError).detail).toEqual({
      status: 200,
      body: rawBody,
      requestPath: '/locations/loc_123/customValues/cv_1',
      method: 'GET',
    });
  });

  it('captures non-JSON bodies on an invalid update response', async () => {
    const rawBody = '<html>Bad Gateway</html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(rawBody),
      }),
    );

    const client = new GhlClient({ baseUrl: 'https://services.test', timeoutMs: 100 });

    const err = await client
      .updateCustomValue('loc_123', 'cv_1', 'pit_secret', { name: 'robot_webhook', value: 'x' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ExternalServiceError);
    expect((err as ExternalServiceError).detail).toMatchObject({
      status: 200,
      body: rawBody,
      requestPath: '/locations/loc_123/customValues/cv_1',
      method: 'PUT',
    });
  });
});
