import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface EncryptedEnvelope {
  v: number;
  alg: 'A256GCM';
  iv: string;
  tag: string;
  data: string;
}

export interface FieldDefinition {
  key: string;
  sensitive?: boolean;
  visibleToCustomer?: boolean;
}

function decodeKey(encoded: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(encoded)) return Buffer.from(encoded, 'hex');
  const base64 = Buffer.from(encoded, 'base64');
  if (base64.length === 32 && base64.toString('base64').replace(/=+$/, '') === encoded.replace(/=+$/, '')) return base64;
  const utf8 = Buffer.from(encoded, 'utf8');
  if (utf8.length !== 32) throw new Error('Encryption key must decode to exactly 32 bytes');
  return utf8;
}

export class EncryptionService {
  private readonly keys = new Map<number, Buffer>();

  constructor(
    keys: Record<number, string>,
    public readonly currentVersion: number,
    private readonly hashKey = keys[currentVersion],
  ) {
    for (const [version, key] of Object.entries(keys)) this.keys.set(Number(version), decodeKey(key));
    if (!this.keys.has(currentVersion)) throw new Error(`Missing encryption key version ${currentVersion}`);
    decodeKey(hashKey);
  }

  static fromEnvironment(env: Record<string, string | undefined> = process.env): EncryptionService {
    const currentVersion = Number(env.ENCRYPTION_KEY_VERSION ?? 1);
    const configured = env.ENCRYPTION_KEYS_JSON
      ? JSON.parse(env.ENCRYPTION_KEYS_JSON) as Record<number, string>
      : { [currentVersion]: env.ENCRYPTION_KEY ?? '' };
    return new EncryptionService(configured, currentVersion, env.PAYLOAD_HASH_KEY ?? configured[currentVersion]);
  }

  encrypt(value: unknown): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      v: this.currentVersion, alg: 'A256GCM', iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'),
    };
    return Buffer.from(JSON.stringify(envelope)).toString('base64url');
  }

  decrypt<T>(encoded: string): T {
    let envelope: EncryptedEnvelope;
    try { envelope = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as EncryptedEnvelope; }
    catch { throw new Error('Encrypted payload envelope is malformed'); }
    if (envelope.alg !== 'A256GCM') throw new Error(`Unsupported encryption algorithm ${envelope.alg}`);
    const key = this.keys.get(envelope.v);
    if (!key) throw new Error(`Unknown encryption key version ${envelope.v}`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final(),
      ]).toString('utf8')) as T;
    } catch { throw new Error('Encrypted payload authentication failed'); }
  }

  normalizedHash(value: unknown): string {
    const normalized = stableStringify(value);
    return createHmac('sha256', decodeKey(this.hashKey)).update(normalized).digest('hex');
  }

  hashesEqual(left: string, right: string): boolean {
    const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(typeof value === 'string' ? value.trim() : value);
}

export function createMaskedPreview(payload: Record<string, unknown>, definitions: readonly FieldDefinition[]): Record<string, unknown> {
  return Object.fromEntries(definitions.filter((field) => field.visibleToCustomer).map((field) => {
    const value = payload[field.key];
    if (!field.sensitive || value === undefined || value === null) return [field.key, value];
    const text = String(value);
    if (text.length <= 4) return [field.key, '*'.repeat(text.length)];
    return [field.key, `${text.slice(0, 2)}${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-2)}`];
  }));
}
