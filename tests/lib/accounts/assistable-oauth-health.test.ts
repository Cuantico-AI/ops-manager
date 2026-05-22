import { describe, expect, it } from 'vitest';
import { resolveAssistableLocationId } from '../../../src/lib/accounts/assistable-oauth-health.js';

describe('resolveAssistableLocationId', () => {
  it('prefers assistable subaccount id over ghl location id', () => {
    const resolved = resolveAssistableLocationId({
      assistableSubaccountId: 'assistable_loc',
      ghlLocationId: 'ghl_loc',
    });

    expect(resolved).toEqual({
      locationId: 'assistable_loc',
      source: 'assistable-subaccount-id',
    });
  });

  it('falls back to ghl location id when assistable subaccount id is missing', () => {
    const resolved = resolveAssistableLocationId({
      assistableSubaccountId: null,
      ghlLocationId: 'ghl_loc',
    });

    expect(resolved).toEqual({
      locationId: 'ghl_loc',
      source: 'ghl-location-id',
    });
  });

  it('returns null when no location id is available', () => {
    expect(
      resolveAssistableLocationId({
        assistableSubaccountId: null,
        ghlLocationId: null,
      }),
    ).toBeNull();
  });
});
