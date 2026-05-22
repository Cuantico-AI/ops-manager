import { ExternalServiceError } from '../errors.js';

export type AssistableOAuthStatus =
  | 'connected'
  | 'disconnected'
  | 'not_found'
  | 'auth-error'
  | 'unreachable';

export interface CheckLocationConnectionInput {
  locationId: string;
}

export interface CheckLocationConnectionResult {
  status: AssistableOAuthStatus;
  httpStatus?: number;
  message?: string;
}

const DEFAULT_ASSISTABLE_API_BASE_URL = 'https://api.assistable.ai';
const DEFAULT_ASSISTABLE_TIMEOUT_MS = 15_000;

const DISCONNECTED_PATTERNS = [
  'no active crm connection',
  'crm connection',
  'oauth',
  'not connected',
  'connection lost',
  're-authorize',
  'reauthorize',
];

export class AssistableClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl?: string; apiKey?: string; timeoutMs?: number } = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.ASSISTABLE_API_BASE_URL ?? DEFAULT_ASSISTABLE_API_BASE_URL;
    this.apiKey = opts.apiKey ?? process.env.ASSISTABLE_API_KEY ?? '';
    this.timeoutMs =
      opts.timeoutMs ?? Number(process.env.ASSISTABLE_API_TIMEOUT_MS ?? DEFAULT_ASSISTABLE_TIMEOUT_MS);
  }

  async checkLocationConnection(
    input: CheckLocationConnectionInput,
  ): Promise<CheckLocationConnectionResult> {
    if (!this.apiKey) {
      return {
        status: 'auth-error',
        message: 'ASSISTABLE_API_KEY is not configured',
      };
    }

    const url = new URL(
      `/v2/get-contacts/${encodeURIComponent(input.locationId)}`,
      this.baseUrl,
    );
    let res: Response;

    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return {
        status: 'unreachable',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (res.ok) {
      return { status: 'connected', httpStatus: res.status };
    }

    const message = await readErrorMessage(res);
    if (res.status === 401) {
      return { status: 'auth-error', httpStatus: res.status, message };
    }
    if (res.status === 404) {
      return { status: 'not_found', httpStatus: res.status, message };
    }
    if (res.status === 403 || looksLikeDisconnected(message)) {
      return { status: 'disconnected', httpStatus: res.status, message };
    }

    return {
      status: 'unreachable',
      httpStatus: res.status,
      message,
    };
  }
}

function looksLikeDisconnected(message?: string): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return DISCONNECTED_PATTERNS.some((pattern) => normalized.includes(pattern));
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

export async function toAssistableError(action: string, res: Response): Promise<ExternalServiceError> {
  const body = await readErrorMessage(res);
  const detail = body ? `: ${body}` : '';
  return new ExternalServiceError(
    `Assistable ${action} failed: ${res.status} ${res.statusText}${detail}`,
    'ASSISTABLE_API_ERROR',
  );
}

export const assistableClient = new AssistableClient();
