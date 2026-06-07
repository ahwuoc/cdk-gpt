import { defaultAliasDomain, deterministicAliasId, generateUniqueCatchAllAlias } from "./alias-generator";
import type { AccountAlias, AccountRepository, CreateAliasInput, HumanUser } from "./types";

const demoHumanUsers: HumanUser[] = [
  {
    id: "user_demo_1",
    email: "owner@example.com",
    displayName: "Demo Owner",
  },
];

const demoAliases: AccountAlias[] = [
  {
    id: "alias_openai_primary",
    humanUserId: "user_demo_1",
    email: "primary@example.com",
    givenName: "Primary",
    familyName: "Account",
    openAiAccountId: "openai_primary",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "alias_openai_backup",
    humanUserId: "user_demo_1",
    email: "backup@example.com",
    givenName: "Backup",
    familyName: "Account",
    openAiAccountId: "openai_backup",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  },
];

export class InMemoryAccountRepository implements AccountRepository {
  private readonly humanUsers = new Map(demoHumanUsers.map((user) => [user.id, user]));
  private readonly aliases = new Map(demoAliases.map((alias) => [alias.id, alias]));

  async getHumanUser(userId: string) {
    return this.humanUsers.get(userId) ?? null;
  }

  async listAliasesForHumanUser(userId: string) {
    return [...this.aliases.values()]
      .filter((alias) => alias.humanUserId === userId)
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  async getAliasById(aliasId: string) {
    return this.aliases.get(aliasId) ?? null;
  }

  async createAlias(input: CreateAliasInput) {
    const email = await generateUniqueCatchAllAlias({
      domain: input.domain || defaultAliasDomain,
      exists: async (candidate) =>
        [...this.aliases.values()].some((alias) => alias.email.toLowerCase() === candidate.toLowerCase()),
    });
    const alias: AccountAlias = {
      id: deterministicAliasId(email),
      humanUserId: input.humanUserId,
      email,
      givenName: input.givenName,
      familyName: input.familyName,
      createdAt: new Date(),
    };

    this.aliases.set(alias.id, alias);
    return alias;
  }
}

export const accountRepository = new InMemoryAccountRepository();
