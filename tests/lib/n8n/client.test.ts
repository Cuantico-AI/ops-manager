import { afterEach, describe, expect, it, vi } from 'vitest';
import { N8nClient } from '../../../src/lib/n8n/client.js';

describe('N8nClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when API key is missing', async () => {
    const client = new N8nClient({ apiKey: '' });
    await expect(client.getWorkflow('wf_1')).rejects.toThrow(/N8N_API_KEY/);
  });

  it('loads a workflow by id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          id: 'wf_1',
          name: 'Client Sync',
          active: true,
        }),
      }),
    );

    const client = new N8nClient({
      baseUrl: 'https://n8n.test',
      apiKey: 'n8n_secret',
      timeoutMs: 100,
    });
    const workflow = await client.getWorkflow('wf_1');

    expect(workflow).toEqual({
      id: 'wf_1',
      name: 'Client Sync',
      active: true,
    });
  });

  it('sends the API key in X-N8N-API-KEY header only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new N8nClient({
      baseUrl: 'https://n8n.test',
      apiKey: 'n8n_secret',
      timeoutMs: 100,
    });
    await client.listExecutions('wf_1');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://n8n.test/api/v1/executions?workflowId=wf_1&limit=20',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.['X-N8N-API-KEY']).toBe('n8n_secret');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('n8n_secret');
  });

  it('executes a workflow via the public API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          id: 'wf_1',
          name: 'Client Sync',
          active: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          executionId: 'exec_123',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new N8nClient({
      baseUrl: 'https://n8n.test',
      apiKey: 'n8n_secret',
      timeoutMs: 100,
    });
    const result = await client.executeWorkflow('wf_1');

    expect(result).toEqual({
      executionId: 'exec_123',
      workflowId: 'wf_1',
      workflowName: 'Client Sync',
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://n8n.test/api/v1/workflows/wf_1/execute',
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
  });
});
