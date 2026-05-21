export type GhlPitTokenStatus = 'valid' | 'invalid' | 'forbidden' | 'not_found' | 'unreachable';

export interface ValidatePitTokenInput {
  locationId: string;
  pitToken: string;
}

export interface ValidatePitTokenResult {
  status: GhlPitTokenStatus;
  httpStatus?: number;
  message?: string;
}

const DEFAULT_GHL_API_BASE_URL = 'https://services.leadconnectorhq.com';
const DEFAULT_GHL_API_VERSION = '2021-07-28';
const DEFAULT_GHL_TIMEOUT_MS = 15_000;

export class GhlClient {
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl?: string; apiVersion?: string; timeoutMs?: number } = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.GHL_API_BASE_URL ?? DEFAULT_GHL_API_BASE_URL;
    this.apiVersion = opts.apiVersion ?? process.env.GHL_API_VERSION ?? DEFAULT_GHL_API_VERSION;
    this.timeoutMs =
      opts.timeoutMs ?? Number(process.env.GHL_API_TIMEOUT_MS ?? DEFAULT_GHL_TIMEOUT_MS);
  }

  async validatePitToken(input: ValidatePitTokenInput): Promise<ValidatePitTokenResult> {
    const url = new URL(`/locations/${encodeURIComponent(input.locationId)}`, this.baseUrl);
    let res: Response;

    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${input.pitToken}`,
          Version: this.apiVersion,
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
      return { status: 'valid', httpStatus: res.status };
    }

    const message = await readErrorMessage(res);
    if (res.status === 401) {
      return { status: 'invalid', httpStatus: res.status, message };
    }
    if (res.status === 403) {
      return { status: 'forbidden', httpStatus: res.status, message };
    }
    if (res.status === 404) {
      return { status: 'not_found', httpStatus: res.status, message };
    }

    return {
      status: 'unreachable',
      httpStatus: res.status,
      message,
    };
  }
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

export const ghlClient = new GhlClient();
