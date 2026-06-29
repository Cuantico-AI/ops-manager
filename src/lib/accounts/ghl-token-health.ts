import { prisma } from '../db/prisma.js';
import { query } from '../db/client.js';
import type { GhlPitTokenStatus } from '../ghl/client.js';

export type AccountTokenHealthStatus =
  | GhlPitTokenStatus
  | 'missing-token'
  | 'missing-location'
  | 'secret-error';

export interface GhlAccountForTokenCheck {
  id: string;
  name: string;
  status: string;
  ghlLocationId: string | null;
  ghlPitTokenRef: string | null;
}

export interface GhlTokenCheckResult {
  accountId: string;
  accountName: string;
  ghlLocationId: string | null;
  status: AccountTokenHealthStatus;
  httpStatus?: number;
  message?: string;
  tokenFingerprint?: string;
  checkedAt: string;
}

export interface GhlTokenCheckSummary {
  total: number;
  valid: number;
  invalid: number;
  forbidden: number;
  notFound: number;
  missingToken: number;
  missingLocation: number;
  secretError: number;
  unreachable: number;
  needsAttention: number;
}

export async function listAccountsForGhlTokenCheck(opts: {
  accountId?: string;
  accountQuery?: string;
  includeInactive?: boolean;
}): Promise<GhlAccountForTokenCheck[]> {
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
      ghl_location_id: true,
      ghl_pit_token_ref: true,
    },
    orderBy: { name: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    ghlLocationId: row.ghl_location_id,
    ghlPitTokenRef: row.ghl_pit_token_ref,
  }));
}

export async function saveGhlTokenCheckResult(result: GhlTokenCheckResult): Promise<void> {
  await query(
    `UPDATE accounts
     SET ghl_token_status = $1,
         ghl_token_checked_at = $2,
         metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $4`,
    [
      result.status,
      result.checkedAt,
      JSON.stringify({
        ghlTokenHealth: {
          status: result.status,
          httpStatus: result.httpStatus ?? null,
          checkedAt: result.checkedAt,
          tokenFingerprint: result.tokenFingerprint ?? null,
          message: result.message ?? null,
        },
      }),
      result.accountId,
    ],
  );
}

export function summarizeGhlTokenChecks(results: GhlTokenCheckResult[]): GhlTokenCheckSummary {
  const summary: GhlTokenCheckSummary = {
    total: results.length,
    valid: 0,
    invalid: 0,
    forbidden: 0,
    notFound: 0,
    missingToken: 0,
    missingLocation: 0,
    secretError: 0,
    unreachable: 0,
    needsAttention: 0,
  };

  for (const result of results) {
    if (result.status === 'valid') summary.valid += 1;
    if (result.status === 'invalid') summary.invalid += 1;
    if (result.status === 'forbidden') summary.forbidden += 1;
    if (result.status === 'not_found') summary.notFound += 1;
    if (result.status === 'missing-token') summary.missingToken += 1;
    if (result.status === 'missing-location') summary.missingLocation += 1;
    if (result.status === 'secret-error') summary.secretError += 1;
    if (result.status === 'unreachable') summary.unreachable += 1;
    if (result.status !== 'valid') summary.needsAttention += 1;
  }

  return summary;
}