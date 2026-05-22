import { describe, expect, it } from 'vitest';
import { fingerprintPitToken, normalizePitToken } from '../../../src/lib/ghl/token-utils.js';

describe('GHL token utilities', () => {
  it('normalizes common pasted PIT token forms', () => {
    expect(normalizePitToken('  Bearer pit_secret  ')).toBe('pit_secret');
    expect(normalizePitToken('"pit_secret"')).toBe('pit_secret');
    expect(normalizePitToken("'pit_secret'")).toBe('pit_secret');
  });

  it('creates stable non-secret token fingerprints', () => {
    expect(fingerprintPitToken('pit_secret')).toHaveLength(12);
    expect(fingerprintPitToken('pit_secret')).toBe(fingerprintPitToken('pit_secret'));
    expect(fingerprintPitToken('pit_secret')).not.toBe(fingerprintPitToken('pit_other'));
  });
});

