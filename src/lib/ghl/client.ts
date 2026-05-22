import { ExternalServiceError } from '../errors.js';

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

export interface GhlPipelineStage {
  id: string;
  name: string;
}

export interface GhlPipeline {
  id: string;
  name: string;
  locationId: string;
  stages: GhlPipelineStage[];
}

export interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue?: number;
}

export interface GhlWorkflow {
  id: string;
  name: string;
  status: string;
  version?: number;
  locationId: string;
  updatedAt?: string;
}

export interface GhlCustomField {
  id: string;
  name: string;
  fieldKey: string;
  dataType?: string;
  model?: string;
}

export interface ListOpportunitiesOptions {
  limit?: number;
  maxPages?: number;
}

const DEFAULT_GHL_API_BASE_URL = 'https://services.leadconnectorhq.com';
const DEFAULT_GHL_API_VERSION = '2021-07-28';
const DEFAULT_GHL_TIMEOUT_MS = 15_000;
const DEFAULT_OPPORTUNITY_PAGE_SIZE = 100;
const DEFAULT_MAX_OPPORTUNITY_PAGES = 20;

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
      res = await this.request(url, input.pitToken);
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

  async listPipelines(locationId: string, pitToken: string): Promise<GhlPipeline[]> {
    const url = new URL('/opportunities/pipelines', this.baseUrl);
    url.searchParams.set('locationId', locationId);
    const res = await this.request(url, pitToken);
    if (!res.ok) {
      throw await toGhlError('list pipelines', res);
    }

    const payload = (await res.json()) as { pipelines?: unknown[] };
    return (payload.pipelines ?? []).map(parsePipeline).filter(Boolean) as GhlPipeline[];
  }

  async listOpportunities(
    locationId: string,
    pitToken: string,
    opts: ListOpportunitiesOptions = {},
  ): Promise<GhlOpportunity[]> {
    const pageSize = opts.limit ?? DEFAULT_OPPORTUNITY_PAGE_SIZE;
    const maxPages = opts.maxPages ?? DEFAULT_MAX_OPPORTUNITY_PAGES;
    const opportunities: GhlOpportunity[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL('/opportunities/search', this.baseUrl);
      url.searchParams.set('location_id', locationId);
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('page', String(page));

      const res = await this.request(url, pitToken);
      if (!res.ok) {
        throw await toGhlError('search opportunities', res);
      }

      const payload = (await res.json()) as {
        opportunities?: unknown[];
        meta?: { nextPage?: number | null; total?: number };
      };
      const pageItems = (payload.opportunities ?? []).map(parseOpportunity).filter(Boolean) as GhlOpportunity[];
      opportunities.push(...pageItems);

      if (pageItems.length < pageSize) {
        break;
      }
      if (payload.meta?.nextPage == null) {
        break;
      }
    }

    return opportunities;
  }

  async listWorkflows(locationId: string, pitToken: string): Promise<GhlWorkflow[]> {
    const url = new URL('/workflows/', this.baseUrl);
    url.searchParams.set('locationId', locationId);
    const res = await this.request(url, pitToken);
    if (!res.ok) {
      throw await toGhlError('list workflows', res);
    }

    const payload = (await res.json()) as { workflows?: unknown[] };
    return (payload.workflows ?? []).map(parseWorkflow).filter(Boolean) as GhlWorkflow[];
  }

  async listCustomFields(locationId: string, pitToken: string): Promise<GhlCustomField[]> {
    const url = new URL(`/locations/${encodeURIComponent(locationId)}/customFields`, this.baseUrl);
    const res = await this.request(url, pitToken);
    if (!res.ok) {
      throw await toGhlError('list custom fields', res);
    }

    const payload = (await res.json()) as { customFields?: unknown[] };
    return (payload.customFields ?? []).map(parseCustomField).filter(Boolean) as GhlCustomField[];
  }

  private async request(url: URL, pitToken: string): Promise<Response> {
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${pitToken}`,
        Version: this.apiVersion,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}

function parsePipeline(value: unknown): GhlPipeline | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const locationId = typeof record.locationId === 'string' ? record.locationId : '';
  if (!id || !name) {
    return null;
  }

  const stages = Array.isArray(record.stages)
    ? record.stages
        .map(parseStage)
        .filter((stage): stage is GhlPipelineStage => stage !== null)
    : [];

  return { id, name, locationId, stages };
}

function parseStage(value: unknown): GhlPipelineStage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const name = typeof record.name === 'string' ? record.name : null;
  if (!id || !name) {
    return null;
  }

  return { id, name };
}

function parseOpportunity(value: unknown): GhlOpportunity | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const pipelineId = typeof record.pipelineId === 'string' ? record.pipelineId : null;
  const pipelineStageId = typeof record.pipelineStageId === 'string' ? record.pipelineStageId : null;
  const status = typeof record.status === 'string' ? record.status : 'unknown';
  if (!id || !name || !pipelineId || !pipelineStageId) {
    return null;
  }

  return {
    id,
    name,
    pipelineId,
    pipelineStageId,
    status,
    monetaryValue: typeof record.monetaryValue === 'number' ? record.monetaryValue : undefined,
  };
}

function parseWorkflow(value: unknown): GhlWorkflow | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const status = typeof record.status === 'string' ? record.status : 'unknown';
  const locationId = typeof record.locationId === 'string' ? record.locationId : '';
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    status,
    version: typeof record.version === 'number' ? record.version : undefined,
    locationId,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  };
}

function parseCustomField(value: unknown): GhlCustomField | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const fieldKey =
    typeof record.fieldKey === 'string'
      ? record.fieldKey
      : typeof record.key === 'string'
        ? record.key
        : null;
  if (!id || !name || !fieldKey) {
    return null;
  }

  return {
    id,
    name,
    fieldKey,
    dataType: typeof record.dataType === 'string' ? record.dataType : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
  };
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

async function toGhlError(action: string, res: Response): Promise<ExternalServiceError> {
  const body = await readErrorMessage(res);
  const detail = body ? `: ${body}` : '';
  return new ExternalServiceError(
    `GHL ${action} failed: ${res.status} ${res.statusText}${detail}`,
    'GHL_API_ERROR',
  );
}

export const ghlClient = new GhlClient();
