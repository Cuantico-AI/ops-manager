import { query } from '../db/client.js';
import { resolveAccountInput, type AccountLookupInput } from '../accounts/resolve-account-input.js';

export interface ClientCheckinSignals {
  accountId: string;
  accountName: string;
  accountStatus: string;
  ghl: {
    locationId: string | null;
    pitTokenPresent: boolean;
    status: string;
    checkedAt: string | null;
    httpStatus: number | null;
    message: string | null;
  };
  assistable: {
    subaccountId: string | null;
    status: string;
    checkedAt: string | null;
    httpStatus: number | null;
    message: string | null;
  };
  n8n: {
    workflowIds: string[];
    workflowCount: number;
    status: string;
    checkedAt: string | null;
    failingWorkflows: number | null;
    staleWorkflows: number | null;
  };
}

export interface AccountHealthRow {
  id: string;
  name: string;
  status: string;
  ghl_location_id: string | null;
  ghl_pit_token_ref: string | null;
  assistable_subaccount_id: string | null;
  n8n_workflow_ids: string[] | null;
  ghl_token_status: string | null;
  ghl_token_checked_at: Date | string | null;
  assistable_oauth_status: string | null;
  assistable_oauth_checked_at: Date | string | null;
  n8n_workflow_status: string | null;
  n8n_workflow_checked_at: Date | string | null;
  metadata: Record<string, unknown> | null;
}

export async function fetchClientCheckinSignals(
  input: AccountLookupInput,
): Promise<ClientCheckinSignals> {
  const account = await resolveAccountInput(input);
  const { rows } = await query<AccountHealthRow>(
    `SELECT id,
            name,
            status,
            ghl_location_id,
            ghl_pit_token_ref,
            assistable_subaccount_id,
            n8n_workflow_ids,
            ghl_token_status,
            ghl_token_checked_at,
            assistable_oauth_status,
            assistable_oauth_checked_at,
            n8n_workflow_status,
            n8n_workflow_checked_at,
            metadata
     FROM accounts
     WHERE id = $1
     LIMIT 1`,
    [account.id],
  );

  return buildClientCheckinSignals(
    rows[0] ?? {
      id: account.id,
      name: account.name,
      status: account.status,
      ghl_location_id: account.ghlLocationId,
      ghl_pit_token_ref: account.ghlPitTokenRef,
      assistable_subaccount_id: null,
      n8n_workflow_ids: [],
      ghl_token_status: null,
      ghl_token_checked_at: null,
      assistable_oauth_status: null,
      assistable_oauth_checked_at: null,
      n8n_workflow_status: null,
      n8n_workflow_checked_at: null,
      metadata: null,
    },
  );
}

export function buildClientCheckinSignals(row: AccountHealthRow): ClientCheckinSignals {
  const metadata = objectValue(row.metadata);
  const ghlMeta = objectValue(metadata.ghlTokenHealth);
  const assistableMeta = objectValue(metadata.assistableOAuthHealth);
  const n8nMeta = objectValue(metadata.n8nWorkflowHealth);
  const workflowIds = row.n8n_workflow_ids ?? [];

  return {
    accountId: row.id,
    accountName: row.name,
    accountStatus: row.status,
    ghl: {
      locationId: row.ghl_location_id,
      pitTokenPresent: Boolean(row.ghl_pit_token_ref),
      status: row.ghl_token_status ?? 'unknown',
      checkedAt: timestampValue(row.ghl_token_checked_at),
      httpStatus: numberValue(ghlMeta.httpStatus),
      message: stringValue(ghlMeta.message),
    },
    assistable: {
      subaccountId: row.assistable_subaccount_id,
      status: row.assistable_oauth_status ?? 'unknown',
      checkedAt: timestampValue(row.assistable_oauth_checked_at),
      httpStatus: numberValue(assistableMeta.httpStatus),
      message: stringValue(assistableMeta.message),
    },
    n8n: {
      workflowIds,
      workflowCount: numberValue(n8nMeta.workflowCount) ?? workflowIds.length,
      status: row.n8n_workflow_status ?? 'unknown',
      checkedAt: timestampValue(row.n8n_workflow_checked_at),
      failingWorkflows: numberValue(n8nMeta.failingWorkflows),
      staleWorkflows: numberValue(n8nMeta.staleWorkflows),
    },
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestampValue(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
