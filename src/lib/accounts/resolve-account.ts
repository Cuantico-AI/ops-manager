import { prisma } from '../db/prisma.js';
import { NotFoundError, ValidationError } from '../errors.js';

export interface ResolvedAccount {
  id: string;
  name: string;
  status: string;
  ghlLocationId: string | null;
  ghlPitTokenRef: string | null;
}

export async function resolveAccountById(accountId: string): Promise<ResolvedAccount> {
  const row = await prisma.accounts.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      status: true,
      ghl_location_id: true,
      ghl_pit_token_ref: true,
    },
  });

  if (!row) {
    throw new NotFoundError(`Account not found: ${accountId}`);
  }

  return mapAccountRow(row);
}

export async function resolveAccountByQuery(
  accountQuery: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ResolvedAccount> {
  const rows = await prisma.accounts.findMany({
    where: {
      name: { contains: accountQuery.trim(), mode: 'insensitive' },
      ...(opts.includeInactive ? {} : { status: 'active' }),
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