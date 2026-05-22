import { ValidationError } from '../errors.js';
import {
  resolveAccountById,
  resolveAccountByQuery,
  type ResolvedAccount,
} from './resolve-account.js';

export interface AccountLookupInput {
  accountId?: string;
  accountQuery?: string;
  includeInactive?: boolean;
}

export async function resolveAccountInput(input: AccountLookupInput): Promise<ResolvedAccount> {
  if (input.accountId) {
    return resolveAccountById(input.accountId);
  }
  if (input.accountQuery) {
    return resolveAccountByQuery(input.accountQuery, {
      includeInactive: input.includeInactive === true,
    });
  }
  throw new ValidationError('accountId or accountQuery is required');
}
