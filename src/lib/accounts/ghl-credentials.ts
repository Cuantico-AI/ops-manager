import { ValidationError } from '../errors.js';
import { PostgresSecretStore } from '../secrets/store.js';

export interface AccountWithGhlCredentials {
  name: string;
  ghlLocationId: string | null;
  ghlPitTokenRef: string | null;
}

export async function getAccountPitToken(account: AccountWithGhlCredentials): Promise<string> {
  if (!account.ghlPitTokenRef) {
    throw new ValidationError(`Account "${account.name}" has no stored GHL PIT token`);
  }
  if (!account.ghlLocationId) {
    throw new ValidationError(`Account "${account.name}" has no GHL location ID`);
  }

  const secretStore = new PostgresSecretStore();
  return secretStore.getSecret(account.ghlPitTokenRef, { kind: 'ghl-pit-token' });
}
