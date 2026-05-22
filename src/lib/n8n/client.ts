import { ExternalServiceError } from '../errors.js';

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
}

export interface N8nExecution {
  id: string;
  status: string;
  finished: boolean;
  startedAt?: string;
  stoppedAt?: string;
}

export interface N8nWorkflowExecutionResult {
  executionId: string;
  workflowId: string;
  workflowName: string;
}

const DEFAULT_N8N_API_BASE_URL = 'https://n8n.voyze.ai';
const DEFAULT_N8N_TIMEOUT_MS = 15_000;
const DEFAULT_EXECUTION_PAGE_SIZE = 20;

export class N8nClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl?: string; apiKey?: string; timeoutMs?: number } = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.N8N_API_BASE_URL ?? DEFAULT_N8N_API_BASE_URL;
    this.apiKey = opts.apiKey ?? process.env.N8N_API_KEY ?? '';
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.N8N_API_TIMEOUT_MS ?? DEFAULT_N8N_TIMEOUT_MS);
  }

  async getWorkflow(workflowId: string): Promise<N8nWorkflow> {
    if (!this.apiKey) {
      throw new ExternalServiceError('N8N_API_KEY is not configured', 'N8N_AUTH_ERROR');
    }

    const url = new URL(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, this.baseUrl);
    const res = await this.request(url);
    if (res.status === 401) {
      throw new ExternalServiceError('n8n API unauthorized', 'N8N_AUTH_ERROR');
    }
    if (res.status === 404) {
      throw new ExternalServiceError(`n8n workflow not found: ${workflowId}`, 'N8N_NOT_FOUND');
    }
    if (!res.ok) {
      throw await toN8nError('get workflow', res);
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const id = typeof payload.id === 'string' ? payload.id : workflowId;
    const name = typeof payload.name === 'string' ? payload.name : workflowId;
    const active = payload.active === true;
    return { id, name, active };
  }

  async listExecutions(workflowId: string, limit = DEFAULT_EXECUTION_PAGE_SIZE): Promise<N8nExecution[]> {
    if (!this.apiKey) {
      throw new ExternalServiceError('N8N_API_KEY is not configured', 'N8N_AUTH_ERROR');
    }

    const url = new URL('/api/v1/executions', this.baseUrl);
    url.searchParams.set('workflowId', workflowId);
    url.searchParams.set('limit', String(limit));
    const res = await this.request(url);
    if (res.status === 401) {
      throw new ExternalServiceError('n8n API unauthorized', 'N8N_AUTH_ERROR');
    }
    if (!res.ok) {
      throw await toN8nError('list executions', res);
    }

    const payload = (await res.json()) as { data?: unknown[] };
    return (payload.data ?? []).map(parseExecution).filter(Boolean) as N8nExecution[];
  }

  async executeWorkflow(
    workflowId: string,
    inputData?: Record<string, unknown>,
  ): Promise<N8nWorkflowExecutionResult> {
    if (!this.apiKey) {
      throw new ExternalServiceError('N8N_API_KEY is not configured', 'N8N_AUTH_ERROR');
    }

    const workflow = await this.getWorkflow(workflowId);
    const url = new URL(
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/execute`,
      this.baseUrl,
    );
    const res = await this.request(url, {
      method: 'POST',
      body: JSON.stringify(inputData ? { inputData } : {}),
    });

    if (res.status === 401) {
      throw new ExternalServiceError('n8n API unauthorized', 'N8N_AUTH_ERROR');
    }
    if (res.status === 404) {
      throw new ExternalServiceError(`n8n workflow not found: ${workflowId}`, 'N8N_NOT_FOUND');
    }
    if (res.status === 405 || res.status === 501) {
      throw new ExternalServiceError(
        'n8n execute endpoint is not available on this instance; upgrade n8n or use a webhook-triggered workflow',
        'N8N_EXECUTE_NOT_SUPPORTED',
      );
    }
    if (!res.ok) {
      throw await toN8nError('execute workflow', res);
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const executionId = parseExecutionId(payload);
    if (!executionId) {
      throw new ExternalServiceError(
        'n8n execute workflow response was missing executionId',
        'N8N_API_ERROR',
      );
    }

    return {
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
    };
  }

  private async request(
    url: URL,
    opts: { method?: string; body?: string } = {},
  ): Promise<Response> {
    return fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': this.apiKey,
      },
      body: opts.body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}

function parseExecution(value: unknown): N8nExecution | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : String(record.id ?? '');
  if (!id) {
    return null;
  }

  return {
    id,
    status: typeof record.status === 'string' ? record.status : 'unknown',
    finished: record.finished === true,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    stoppedAt: typeof record.stoppedAt === 'string' ? record.stoppedAt : undefined,
  };
}

function parseExecutionId(payload: Record<string, unknown>): string | null {
  if (typeof payload.executionId === 'string') {
    return payload.executionId;
  }

  const data = payload.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.executionId === 'string') {
      return record.executionId;
    }
    if (typeof record.id === 'string') {
      return record.id;
    }
  }

  return null;
}

async function readErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = await res.text();
    const trimmed = body.trim();
    return trimmed ? trimmed.slice(0, 500) : undefined;
  } catch {
    return undefined;
  }
}

async function toN8nError(action: string, res: Response): Promise<ExternalServiceError> {
  const body = await readErrorMessage(res);
  const detail = body ? `: ${body}` : '';
  return new ExternalServiceError(
    `n8n ${action} failed: ${res.status} ${res.statusText}${detail}`,
    'N8N_API_ERROR',
  );
}

export const n8nClient = new N8nClient();
