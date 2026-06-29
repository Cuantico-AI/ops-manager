import { prisma } from '../db/prisma.js';
import { query } from '../db/client.js';
import type { AssistableOAuthStatus } from '../assistable/client.js';

export type AccountAssistableOAuthStatus =
  | AssistableOAuthStatus
  | 'missing-subaccount-id';

export interface AssistableAccountForOAuthCheck {
  id: string;
  name: string;
  status: string;
  assistableSubaccountId: string | null;
  ghlLocationId: string | null;
}

export interface AssistableOAuthCheckResult {
  accountId: string;
  accountName: string;
  assistableLocationId: string | null;
  locationSource: 'assistable-subaccount-id' | 'ghl-location-id' | null;
  status: AccountAssistableOAuthStatus;
  httpStatus?: number;
  message?: string;
  checkedAt: string;
}

export interface AssistableOAuthCheckSummary {
  total: number;
  connected: number;
  disconnected: number;
  notFound: number;
  authError: number;
  missingSubaccountId: number;
  unreachable: number;
  needsAttention: number;
}

export function resolveAssistableLocationId(
  account: Pick<AssistableAccountForOAuthCheck, 'assistableSubaccountId' | 'ghlLocationId'>,
): { locationId: string; source: 'assistable-subaccount-id' | 'ghl-location-id' } | null {
  if (account.assistableSubaccountId) {
    return {
      locationId: account.assistableSubaccountId,
      source: 'assistable-subaccount-id',
    };
  }
  if (account.ghlLocationId) {
    return {
      locationId: account.ghlLocationId,
      source: 'ghl-location-id',
    };
  }
  return null;
}

export async function listAccountsForAssistableOAuthCheck(opts: {
  accountId?: string;
  accountQuery?: string;
  includeInactive?: boolean;
}): Promise<AssistableAccountForOAuthCheck[]> {
  const rows = await prisma.accounts.findMany({
    where: {
      ...(opts.accountId ? { id: opts.accountId } : {}),
      ...(opts.accountQuery
        ? { name: { contains: opts.accountQuery, mode: 'insensitive' } }
        : {}),
      ...(!opts.includeInactive ? { status: 'active' } : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      assistable_subaccount_id: true,
      ghl_location_id: true,
    },
    orderBy: { name: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    assistableSubaccountId: row.assistable_subaccount_id,
    ghlLocationId: row.ghl_location_id,
  }));
}

export async function saveAssistableOAuthCheckResult(
  result: AssistableOAuthCheckResult,
): Promise<void> {
  await query(
    `UPDATE accounts
     SET assistable_oauth_status = $1,
         assistable_oauth_checked_at = $2,
         metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $4`,
    [
      result.status,
      result.checkedAt,
      JSON.stringify({
        assistableOAuthHealth: {
          status: result.status,
          assistableLocationId: result.assistableLocationId,
          locationSource: result.locationSource,
          httpStatus: result.httpStatus ?? null,
          checkedAt: result.checkedAt,
          message: result.message ?? null,
        },
      }),
      result.accountId,
    ],
  );
}

export function summarizeAssistableOAuthChecks(
  results: AssistableOAuthCheckResult[],
): AssistableOAuthCheckSummary {
  const summary: AssistableOAuthCheckSummary = {
    total: results.length,
    connected: 0,
    disconnected: 0,
    notFound: 0,
    authError: 0,
    missingSubaccountId: 0,
    unreachable: 0,
    needsAttention: 0,
  };

  for (const result of results) {
    if (result.status === 'connected') summary.connected += 1;
    if (result.status === 'disconnected') summary.disconnected += 1;
    if (result.status === 'not_found') summary.notFound += 1;
    if (result.status === 'auth-error') summary.authError += 1;
    if (result.status === 'missing-subaccount-id') summary.missingSubaccountId += 1;
    if (result.status === 'unreachable') summary.unreachable += 1;
    if (result.status !== 'connected') summary.needsAttention += 1;
  }

  return summary;
}