export type AccountStatus = "reg-success" | "reg-failed" | "not-registered";

export type AccountSaleStatus = "available" | "reserved" | "sold";

export type AccountDocument = {
  id: string;
  email: string;
  accountId: string;
  status: AccountStatus;
  saleStatus: AccountSaleStatus;
  soldOrderId?: string;
  soldAt?: Date;
  password?: string;
  sessionToken?: string;
  mailkp?: string;
  passwordMailkp?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AccountView = {
  id: string;
  email: string;
  accountId: string;
  status: AccountStatus;
  saleStatus: AccountSaleStatus;
  soldOrderId?: string;
  password?: string;
  sessionToken?: string;
  passwordMasked: string;
  tokenMasked: string;
  mailkpMasked: string;
  passwordMailkpMasked: string;
  createdAt: string;
};

export type CreateAccountInput = {
  email: string;
  accountId: string;
  status: AccountStatus;
  password?: string;
  sessionToken?: string;
  mailkp?: string;
  passwordMailkp?: string;
};
