import { Redis as UpstashRedis } from "@upstash/redis";
import Redis from "ioredis";
import type { Adapter, AdapterPayload } from "oidc-provider";
import { readEnv } from "./env";

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

const modelFallbacks = [
  "",
  "Interaction",
  "Session",
  "Grant",
  "AuthorizationCode",
  "AccessToken",
  "RefreshToken",
  "DeviceCode",
  "BackchannelAuthenticationRequest",
  "PushedAuthorizationRequest",
  "ReplayDetection",
];

function key(model: string, id: string) {
  return `oidc:${model}:${id}`;
}

function candidateKeys(model: string, id: string) {
  return [...new Set([model, ...modelFallbacks])].map((candidate) => key(candidate, id));
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
  const url = readEnv("REDIS_URL");
  return url ? new Redis(url, { maxRetriesPerRequest: 2 }) : null;
}

function getUpstashRedis() {
  const url = readEnv("UPSTASH_REDIS_REST_URL");
  const token = readEnv("UPSTASH_REDIS_REST_TOKEN");

  return url && token ? new UpstashRedis({ url, token }) : null;
}

const upstash = getUpstashRedis();
const redis = upstash ? null : getRedis();

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

function normalizeTtl(expiresIn?: number | null) {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    return null;
  }

  return Math.max(1, expiresIn);
}

export class RedisAdapter implements Adapter {
  constructor(private readonly model: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number | null) {
    const storageKey = key(this.model, id);
    const ttl = normalizeTtl(expiresIn);

    if (upstash) {
      if (ttl) {
        await upstash.set(storageKey, payload, { ex: ttl });
      } else {
        await upstash.set(storageKey, payload);
      }

      if (payload.userCode) {
        if (ttl) {
          await upstash.set(userCodeKey(String(payload.userCode)), id, { ex: ttl });
        } else {
          await upstash.set(userCodeKey(String(payload.userCode)), id);
        }
      }

      if (payload.uid) {
        if (ttl) {
          await upstash.set(uidKey(String(payload.uid)), id, { ex: ttl });
        } else {
          await upstash.set(uidKey(String(payload.uid)), id);
        }
      }

      if (payload.grantId && grantable.has(this.model)) {
        await upstash.sadd(grantKey(String(payload.grantId)), storageKey);
        if (ttl) {
          await upstash.expire(grantKey(String(payload.grantId)), ttl);
        }
      }

      return;
    }

    if (redis) {
      const multi = redis.multi();

      if (ttl) {
        multi.set(storageKey, JSON.stringify(payload), "EX", ttl);
      } else {
        multi.set(storageKey, JSON.stringify(payload));
      }

      if (payload.userCode) {
        if (ttl) {
          multi.set(userCodeKey(String(payload.userCode)), id, "EX", ttl);
        } else {
          multi.set(userCodeKey(String(payload.userCode)), id);
        }
      }

      if (payload.uid) {
        if (ttl) {
          multi.set(uidKey(String(payload.uid)), id, "EX", ttl);
        } else {
          multi.set(uidKey(String(payload.uid)), id);
        }
      }

      if (payload.grantId && grantable.has(this.model)) {
        multi.sadd(grantKey(String(payload.grantId)), storageKey);
        if (ttl) {
          multi.expire(grantKey(String(payload.grantId)), ttl);
        }
      }

      await multi.exec();
      return;
    }

    memoryStore.set(storageKey, {
      payload,
      expiresAt: ttl ? Date.now() + ttl * 1000 : Number.POSITIVE_INFINITY,
    });

    if (payload.userCode) rememberSet(userCodeKey(String(payload.userCode)), id);
    if (payload.uid) rememberSet(uidKey(String(payload.uid)), id);
    if (payload.grantId && grantable.has(this.model)) rememberSet(grantKey(String(payload.grantId)), storageKey);
  }

  async find(id: string) {
    if (upstash) {
      for (const storageKey of candidateKeys(this.model, id)) {
        const payload = await upstash.get<StoredPayload>(storageKey);
        if (payload) return payload;
      }
      return undefined;
    }

    if (redis) {
      for (const storageKey of candidateKeys(this.model, id)) {
        const payload = await redis.get(storageKey);
        if (payload) return JSON.parse(payload) as StoredPayload;
      }
      return undefined;
    }

    for (const storageKey of candidateKeys(this.model, id)) {
      const payload = getActiveMemoryValue(storageKey);
      if (payload) return payload;
    }
    return undefined;
  }

  async findByUserCode(userCode: string) {
    if (upstash) {
      const id = await upstash.get<string>(userCodeKey(userCode));
      return id ? this.find(id) : undefined;
    }

    if (redis) {
      const id = await redis.get(userCodeKey(userCode));
      return id ? this.find(id) : undefined;
    }

    const [id] = memorySets.get(userCodeKey(userCode)) ?? [];
    return id ? this.find(id) : undefined;
  }

  async findByUid(uid: string) {
    if (upstash) {
      const id = await upstash.get<string>(uidKey(uid));
      return id ? this.find(id) : undefined;
    }

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
    if (upstash) {
      await upstash.del(storageKey);
      return;
    }

    if (redis) {
      await redis.del(storageKey);
      return;
    }

    memoryStore.delete(storageKey);
  }

  async revokeByGrantId(grantId: string) {
    const storageGrantKey = grantKey(grantId);

    if (upstash) {
      const tokenKeys = await upstash.smembers<string[]>(storageGrantKey);
      if (tokenKeys.length > 0) {
        await upstash.del(...tokenKeys);
      }
      await upstash.del(storageGrantKey);
      return;
    }

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
