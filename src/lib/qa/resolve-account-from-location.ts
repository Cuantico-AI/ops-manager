import { query } from '../db/client.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { ResolvedAccount } from '../accounts/resolve-account.js';

export async function resolveAccountByLocationId(locationId: string): Promise<ResolvedAccount> {
  const { rows } = await query<{
    id: string;
    name: string;
    status: string;
    ghl_location_id: string | null;
    ghl_pit_token_ref: string | null;
  }>(
    `SELECT id, name, status, ghl_location_id, ghl_pit_token_ref
     FROM accounts
     WHERE ghl_location_id = $1 OR assistable_subaccount_id = $1
     ORDER BY name ASC`,
    [locationId.trim()],
  );

  if (rows.length === 0) {
    throw new NotFoundError(`No account matched Assistable location ID "${locationId}"`);
  }
  if (rows.length > 1) {
    const names = rows.map((row) => row.name).join(', ');
    throw new ValidationError(
      `Assistable location ID "${locationId}" matched multiple accounts: ${names}`,
    );
  }

  const row = rows[0]!;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    ghlLocationId: row.ghl_location_id,
    ghlPitTokenRef: row.ghl_pit_token_ref,
  };
}
