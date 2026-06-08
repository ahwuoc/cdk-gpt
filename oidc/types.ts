export type HumanUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AccountAlias = {
  id: string;
  humanUserId: string;
  email: string;
  givenName: string;
  familyName: string;
  openAiAccountId?: string;
  createdAt: Date;
};

export type CreateAliasInput = {
  humanUserId: string;
  domain?: string;
  givenName: string;
  familyName: string;
};

export type AccountRepository = {
  getHumanUser(userId: string): Promise<HumanUser | null>;
  listAliasesForHumanUser(userId: string): Promise<AccountAlias[]>;
  getAliasById(aliasId: string): Promise<AccountAlias | null>;
  createAlias(input: CreateAliasInput): Promise<AccountAlias>;
  deleteAlias(aliasId: string): Promise<boolean>;
};
