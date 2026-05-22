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
const HEALTH_PROBE_CONTACT_ID = 'ops-manager-health-probe';

const DISCONNECTED_PATTERNS = [
  'no access token for location',
  'no active crm connection',
  'crm connection',
  'oauth',
  'not connected',
  'connection lost',
  're-authorize',
  'reauthorize',
];

const CONNECTED_PATTERNS = ['no ghl conversation found for contact'];

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

    const url = new URL('/v2/get-conversation', this.baseUrl);
    url.searchParams.set('location_id', input.locationId);
    url.searchParams.set('contact_id', HEALTH_PROBE_CONTACT_ID);
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

    const message = await readResponseMessage(res);
    if (res.status === 401) {
      return { status: 'auth-error', httpStatus: res.status, message };
    }

    if (isRouteNotFound(message, res.status)) {
      return {
        status: 'unreachable',
        httpStatus: res.status,
        message:
          message ??
          'Assistable route not found; the platform may have migrated away from this endpoint',
      };
    }

    if (res.ok) {
      const mapped = mapConversationProbe(message);
      if (mapped) {
        return { status: mapped, httpStatus: res.status, message };
      }
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

function mapConversationProbe(message?: string): AssistableOAuthStatus | null {
  if (!message) {
    return 'connected';
  }

  const normalized = message.toLowerCase();
  if (CONNECTED_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'connected';
  }
  if (DISCONNECTED_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'disconnected';
  }
  return null;
}

function isRouteNotFound(message: string | undefined, status: number): boolean {
  if (status !== 404 || !message) {
    return false;
  }

  return message.includes('Route ') && message.includes(' not found');
}

function looksLikeDisconnected(message?: string): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return DISCONNECTED_PATTERNS.some((pattern) => normalized.includes(pattern));
}

async function readResponseMessage(res: Response): Promise<string | undefined> {
  try {
    const body = await res.text();
    const trimmed = body.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim().slice(0, 500);
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim().slice(0, 500);
      }
    } catch {
      // Fall through to raw text.
    }

    return trimmed.slice(0, 500);
  } catch {
    return undefined;
  }
}

export async function toAssistableError(action: string, res: Response): Promise<ExternalServiceError> {
  const body = await readResponseMessage(res);
  const detail = body ? `: ${body}` : '';
  return new ExternalServiceError(
    `Assistable ${action} failed: ${res.status} ${res.statusText}${detail}`,
    'ASSISTABLE_API_ERROR',
  );
}

export const assistableClient = new AssistableClient();
