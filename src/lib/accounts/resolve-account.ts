import { query } from '../db/client.js';
import { NotFoundError, ValidationError } from '../errors.js';

export interface ResolvedAccount {
  id: string;
  name: string;
  status: string;
  ghlLocationId: string | null;
  ghlPitTokenRef: string | null;
}

export async function resolveAccountById(accountId: string): Promise<ResolvedAccount> {
  const { rows } = await query<{
    id: string;
    name: string;
    status: string;
    ghl_location_id: string | null;
    ghl_pit_token_ref: string | null;
  }>(
    `SELECT id, name, status, ghl_location_id, ghl_pit_token_ref
     FROM accounts
     WHERE id = $1
     LIMIT 1`,
    [accountId],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Account not found: ${accountId}`);
  }

  return mapAccountRow(row);
}

export async function resolveAccountByQuery(
  accountQuery: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ResolvedAccount> {
  const clauses = ['name ILIKE $1'];
  const params: unknown[] = [`%${accountQuery.trim()}%`];

  if (!opts.includeInactive) {
    clauses.push("status = 'active'");
  }

  const { rows } = await query<{
    id: string;
    name: string;
    status: string;
    ghl_location_id: string | null;
    ghl_pit_token_ref: string | null;
  }>(
    `SELECT id, name, status, ghl_location_id, ghl_pit_token_ref
     FROM accounts
     WHERE ${clauses.join(' AND ')}
     ORDER BY name ASC`,
    params,
  );

  if (rows.length === 0) {
    throw new NotFoundError(`No account matched "${accountQuery}"`);
  }
  if (rows.length > 1) {
    const names = rows.map((row) => row.name).join(', ');
    throw new ValidationError(
      `Account query "${accountQuery}" matched multiple accounts: ${names}. Be more specific.`,
    );
  }

  return mapAccountRow(rows[0]);
}

function mapAccountRow(row: {
  id: string;
  name: string;
  status: string;
  ghl_location_id: string | null;
  ghl_pit_token_ref: string | null;
}): ResolvedAccount {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    ghlLocationId: row.ghl_location_id,
    ghlPitTokenRef: row.ghl_pit_token_ref,
  };
}
