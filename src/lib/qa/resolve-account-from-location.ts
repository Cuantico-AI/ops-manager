import { prisma } from '../db/prisma.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { ResolvedAccount } from '../accounts/resolve-account.js';

export async function resolveAccountByLocationId(locationId: string): Promise<ResolvedAccount> {
  const rows = await prisma.accounts.findMany({
    where: {
      OR: [
        { ghl_location_id: locationId.trim() },
        { assistable_subaccount_id: locationId.trim() },
      ],
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