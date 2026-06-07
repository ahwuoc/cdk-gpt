import Redis from "ioredis";
import type { Adapter, AdapterPayload } from "oidc-provider";

type StoredPayload = AdapterPayload & {
  consumed?: number;
};

const grantable = new Set([
  "AccessToken",
  "AuthorizationCode",
  "RefreshToken",
  "DeviceCode",
  "BackchannelAuthenticationRequest",
]);

function key(model: string, id: string) {
  return `oidc:${model}:${id}`;
}

function grantKey(grantId: string) {
  return `oidc:grant:${grantId}`;
}

function userCodeKey(userCode: string) {
  return `oidc:userCode:${userCode}`;
}

function uidKey(uid: string) {
  return `oidc:uid:${uid}`;
}

function getRedis() {
  const url = process.env.REDIS_URL;
  return url ? new Redis(url, { maxRetriesPerRequest: 2 }) : null;
}

const redis = getRedis();

const memoryStore = new Map<string, { payload: StoredPayload; expiresAt: number }>();
const memorySets = new Map<string, Set<string>>();

function rememberSet(setKey: string, value: string) {
  const values = memorySets.get(setKey) ?? new Set<string>();
  values.add(value);
  memorySets.set(setKey, values);
}

function getActiveMemoryValue(storageKey: string) {
  const item = memoryStore.get(storageKey);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    memoryStore.delete(storageKey);
    return undefined;
  }
  return item.payload;
}

export class RedisAdapter implements Adapter {
  constructor(private readonly model: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number) {
    const storageKey = key(this.model, id);
    const ttl = Math.max(1, expiresIn);

    if (redis) {
      const multi = redis.multi().set(storageKey, JSON.stringify(payload), "EX", ttl);

      if (payload.userCode) {
        multi.set(userCodeKey(String(payload.userCode)), id, "EX", ttl);
      }

      if (payload.uid) {
        multi.set(uidKey(String(payload.uid)), id, "EX", ttl);
      }

      if (payload.grantId && grantable.has(this.model)) {
        multi.sadd(grantKey(String(payload.grantId)), storageKey);
        multi.expire(grantKey(String(payload.grantId)), ttl);
      }

      await multi.exec();
      return;
    }

    memoryStore.set(storageKey, {
      payload,
      expiresAt: Date.now() + ttl * 1000,
    });

    if (payload.userCode) rememberSet(userCodeKey(String(payload.userCode)), id);
    if (payload.uid) rememberSet(uidKey(String(payload.uid)), id);
    if (payload.grantId && grantable.has(this.model)) rememberSet(grantKey(String(payload.grantId)), storageKey);
  }

  async find(id: string) {
    const storageKey = key(this.model, id);
    if (redis) {
      const payload = await redis.get(storageKey);
      return payload ? (JSON.parse(payload) as StoredPayload) : undefined;
    }

    return getActiveMemoryValue(storageKey);
  }

  async findByUserCode(userCode: string) {
    if (redis) {
      const id = await redis.get(userCodeKey(userCode));
      return id ? this.find(id) : undefined;
    }

    const [id] = memorySets.get(userCodeKey(userCode)) ?? [];
    return id ? this.find(id) : undefined;
  }

  async findByUid(uid: string) {
    if (redis) {
      const id = await redis.get(uidKey(uid));
      return id ? this.find(id) : undefined;
    }

    const [id] = memorySets.get(uidKey(uid)) ?? [];
    return id ? this.find(id) : undefined;
  }

  async consume(id: string) {
    const payload = await this.find(id);
    if (!payload) return;

    await this.upsert(id, { ...payload, consumed: Math.floor(Date.now() / 1000) }, 60);
  }

  async destroy(id: string) {
    const storageKey = key(this.model, id);
    if (redis) {
      await redis.del(storageKey);
      return;
    }

    memoryStore.delete(storageKey);
  }

  async revokeByGrantId(grantId: string) {
    const storageGrantKey = grantKey(grantId);

    if (redis) {
      const tokenKeys = await redis.smembers(storageGrantKey);
      if (tokenKeys.length > 0) {
        await redis.del(...tokenKeys);
      }
      await redis.del(storageGrantKey);
      return;
    }

    for (const tokenKey of memorySets.get(storageGrantKey) ?? []) {
      memoryStore.delete(tokenKey);
    }
    memorySets.delete(storageGrantKey);
  }
}
