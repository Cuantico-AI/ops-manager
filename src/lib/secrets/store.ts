import { createCipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { query } from '../db/client.js';
import { ValidationError } from '../errors.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';

export interface SecretStore {
  upsertSecret(input: UpsertSecretInput, client?: pg.PoolClient): Promise<string>;
}

export interface UpsertSecretInput {
  id: string;
  kind: string;
  plaintext: string;
  metadata?: Record<string, unknown>;
}

function decodeMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ValidationError('SECRETS_MASTER_KEY is required to store roster tokens');
  }

  const decoded = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : decodeBase64Url(trimmed);

  if (decoded.length === 32) {
    return decoded;
  }

  const utf8 = Buffer.from(trimmed, 'utf8');
  if (utf8.length === 32) {
    return utf8;
  }

  throw new ValidationError('SECRETS_MASTER_KEY must decode to 32 bytes');
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

export class PostgresSecretStore implements SecretStore {
  private readonly key: Buffer;

  constructor(masterKey: string | undefined = process.env.SECRETS_MASTER_KEY) {
    if (!masterKey) {
      throw new ValidationError('SECRETS_MASTER_KEY is required to store roster tokens');
    }
    this.key = decodeMasterKey(masterKey);
  }

  async upsertSecret(input: UpsertSecretInput, client?: pg.PoolClient): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const executor = client ?? { query };
    await executor.query(
      `INSERT INTO secrets (id, kind, encrypted_value, iv, auth_tag, key_version, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         encrypted_value = EXCLUDED.encrypted_value,
         iv = EXCLUDED.iv,
         auth_tag = EXCLUDED.auth_tag,
         key_version = EXCLUDED.key_version,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        input.id,
        input.kind,
        encrypted.toString('base64'),
        iv.toString('base64'),
        authTag.toString('base64'),
        KEY_VERSION,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    return `secret:${input.id}`;
  }
}
