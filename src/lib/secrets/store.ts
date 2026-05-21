import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { query } from '../db/client.js';
import { NotFoundError, ValidationError } from '../errors.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';

export interface SecretStore {
  upsertSecret(input: UpsertSecretInput, client?: pg.PoolClient): Promise<string>;
  getSecret(idOrRef: string, opts?: GetSecretOptions, client?: pg.PoolClient): Promise<string>;
}

export interface UpsertSecretInput {
  id: string;
  kind: string;
  plaintext: string;
  metadata?: Record<string, unknown>;
}

export interface GetSecretOptions {
  kind?: string;
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

    const sql = `INSERT INTO secrets (id, kind, encrypted_value, iv, auth_tag, key_version, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         encrypted_value = EXCLUDED.encrypted_value,
         iv = EXCLUDED.iv,
         auth_tag = EXCLUDED.auth_tag,
         key_version = EXCLUDED.key_version,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`;
    const params = [
      input.id,
      input.kind,
      encrypted.toString('base64'),
      iv.toString('base64'),
      authTag.toString('base64'),
      KEY_VERSION,
      JSON.stringify(input.metadata ?? {}),
    ];

    if (client) {
      await client.query(sql, params);
    } else {
      await query(sql, params);
    }

    return `secret:${input.id}`;
  }

  async getSecret(
    idOrRef: string,
    opts: GetSecretOptions = {},
    client?: pg.PoolClient,
  ): Promise<string> {
    const id = normalizeSecretId(idOrRef);
    const sql =
      'SELECT kind, encrypted_value, iv, auth_tag, key_version FROM secrets WHERE id = $1 LIMIT 1';
    const result = client
      ? await client.query<SecretRow>(sql, [id])
      : await query<SecretRow>(sql, [id]);
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError(`Secret not found: ${id}`);
    }
    if (opts.kind && row.kind !== opts.kind) {
      throw new ValidationError(`Secret ${id} has kind ${row.kind}, expected ${opts.kind}`);
    }
    if (row.key_version !== KEY_VERSION) {
      throw new ValidationError(`Unsupported secret key version: ${row.key_version}`);
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(row.encrypted_value, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

interface SecretRow {
  kind: string;
  encrypted_value: string;
  iv: string;
  auth_tag: string;
  key_version: string;
}

function normalizeSecretId(idOrRef: string): string {
  return idOrRef.startsWith('secret:') ? idOrRef.slice('secret:'.length) : idOrRef;
}
