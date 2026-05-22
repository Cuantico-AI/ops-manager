import { getAccountPitToken } from '../accounts/ghl-credentials.js';
import type { GhlSnapshotAccount } from './fetch-account-snapshot.js';
import { ghlClient, type GhlClient } from './client.js';
import { type GhlAccountInventory } from './inventory.js';

export async function fetchGhlAccountInventory(
  account: GhlSnapshotAccount,
  client: GhlClient = ghlClient,
): Promise<GhlAccountInventory> {
  const pitToken = await getAccountPitToken(account);
  const locationId = account.ghlLocationId!;
  const [workflows, customFields] = await Promise.all([
    client.listWorkflows(locationId, pitToken),
    client.listCustomFields(locationId, pitToken),
  ]);

  return {
    accountId: account.id,
    accountName: account.name,
    locationId,
    workflows,
    customFields,
    capturedAt: new Date().toISOString(),
  };
}
