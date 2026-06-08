import { Redis as UpstashRedis } from "@upstash/redis";
import Redis from "ioredis";
import { defaultAliasDomain, deterministicAliasId, generateUniqueCatchAllAlias } from "./alias-generator";
import { readEnv } from "./env";
import type { AccountAlias, AccountRepository, CreateAliasInput, HumanUser } from "./types";

const demoHumanUsers: HumanUser[] = [
  {
    id: "user_demo_1",
    email: `owner@${defaultAliasDomain}`,
    displayName: "Demo Owner",
  },
];

const demoAliases: AccountAlias[] = [
  {
    id: "alias_openai_primary",
    humanUserId: "user_demo_1",
    email: `primary@${defaultAliasDomain}`,
    givenName: "Primary",
    familyName: "Account",
    openAiAccountId: "openai_primary",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "alias_openai_backup",
    humanUserId: "user_demo_1",
    email: `backup@${defaultAliasDomain}`,
    givenName: "Backup",
    familyName: "Account",
    openAiAccountId: "openai_backup",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  },
];

type StoredAlias = Omit<AccountAlias, "createdAt"> & {
  createdAt: string;
};

function aliasKey(aliasId: string) {
  return `account-alias:${aliasId}`;
}

function userAliasesKey(humanUserId: string) {
  return `account-aliases:${humanUserId}`;
}

function serializeAlias(alias: AccountAlias): StoredAlias {
  return {
    ...alias,
    createdAt: alias.createdAt.toISOString(),
  };
}

function deserializeAlias(alias: StoredAlias): AccountAlias {
  return {
    ...alias,
    createdAt: new Date(alias.createdAt),
  };
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

export class InMemoryAccountRepository implements AccountRepository {
  private readonly humanUsers = new Map(demoHumanUsers.map((user) => [user.id, user]));
  private readonly aliases = new Map(demoAliases.map((alias) => [alias.id, alias]));

  async getHumanUser(userId: string) {
    return this.humanUsers.get(userId) ?? null;
  }

  async listAliasesForHumanUser(userId: string) {
    const aliases = [...this.aliases.values()].filter((alias) => alias.humanUserId === userId);

    if (upstash) {
      const aliasIds = await upstash.smembers<string[]>(userAliasesKey(userId));
      const storedAliases = await Promise.all(
        aliasIds.map(async (aliasId) => {
          const alias = await upstash.get<StoredAlias>(aliasKey(aliasId));
          return alias ? deserializeAlias(alias) : null;
        }),
      );
      aliases.push(...storedAliases.filter((alias): alias is AccountAlias => Boolean(alias)));
    } else if (redis) {
      const aliasIds = await redis.smembers(userAliasesKey(userId));
      const storedAliases = await Promise.all(
        aliasIds.map(async (aliasId) => {
          const alias = await redis.get(aliasKey(aliasId));
          return alias ? deserializeAlias(JSON.parse(alias) as StoredAlias) : null;
        }),
      );
      aliases.push(...storedAliases.filter((alias): alias is AccountAlias => Boolean(alias)));
    }

    return aliases.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async getAliasById(aliasId: string) {
    if (upstash) {
      const alias = await upstash.get<StoredAlias>(aliasKey(aliasId));
      if (alias) return deserializeAlias(alias);
    } else if (redis) {
      const alias = await redis.get(aliasKey(aliasId));
      if (alias) return deserializeAlias(JSON.parse(alias) as StoredAlias);
    }

    return this.aliases.get(aliasId) ?? null;
  }

  async createAlias(input: CreateAliasInput) {
    const existingAliases = await this.listAliasesForHumanUser(input.humanUserId);
    const email = await generateUniqueCatchAllAlias({
      domain: input.domain || defaultAliasDomain,
      exists: async (candidate) =>
        existingAliases.some((alias) => alias.email.toLowerCase() === candidate.toLowerCase()),
    });
    const alias: AccountAlias = {
      id: deterministicAliasId(email),
      humanUserId: input.humanUserId,
      email,
      givenName: input.givenName || "Generated",
      familyName: input.familyName || "Alias",
      createdAt: new Date(),
    };

    if (upstash) {
      await upstash.set(aliasKey(alias.id), serializeAlias(alias));
      await upstash.sadd(userAliasesKey(input.humanUserId), alias.id);
    } else if (redis) {
      const multi = redis.multi();
      multi.set(aliasKey(alias.id), JSON.stringify(serializeAlias(alias)));
      multi.sadd(userAliasesKey(input.humanUserId), alias.id);
      await multi.exec();
    } else {
      this.aliases.set(alias.id, alias);
    }

    return alias;
  }

  async deleteAlias(aliasId: string) {
    const alias = await this.getAliasById(aliasId);
    if (!alias) return false;

    if (upstash) {
      await upstash.del(aliasKey(aliasId));
      await upstash.srem(userAliasesKey(alias.humanUserId), aliasId);
      return true;
    }

    if (redis) {
      const multi = redis.multi();
      multi.del(aliasKey(aliasId));
      multi.srem(userAliasesKey(alias.humanUserId), aliasId);
      await multi.exec();
      return true;
    }

    return this.aliases.delete(aliasId);
  }
}

export const accountRepository = new InMemoryAccountRepository();
