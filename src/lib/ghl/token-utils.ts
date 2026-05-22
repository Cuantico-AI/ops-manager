import { createHash } from 'node:crypto';

export function normalizePitToken(raw: string): string {
  return raw
    .trim()
    .replace(/^\ufeff/, '')
    .replace(/^bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

export function fingerprintPitToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12);
}

