import { getAccountPitToken } from '../accounts/ghl-credentials.js';
import type { ResolvedAccount } from '../accounts/resolve-account.js';
import { ghlClient, type GhlClient } from './client.js';
import { buildGhlAccountSnapshot, type GhlAccountSnapshot } from './snapshot.js';

export type GhlSnapshotAccount = Pick<
  ResolvedAccount,
  'id' | 'name' | 'ghlLocationId' | 'ghlPitTokenRef'
>;

export async function fetchGhlAccountSnapshot(
  account: GhlSnapshotAccount,
  client: GhlClient = ghlClient,
): Promise<GhlAccountSnapshot> {
  const pitToken = await getAccountPitToken(account);
  const locationId = account.ghlLocationId!;
  const [pipelines, opportunities] = await Promise.all([
    client.listPipelines(locationId, pitToken),
    client.listOpportunities(locationId, pitToken),
  ]);

  return buildGhlAccountSnapshot({
    accountId: account.id,
    accountName: account.name,
    locationId,
    pipelines,
    opportunities,
  });
}
