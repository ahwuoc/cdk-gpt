import type {
  AccountDocument,
  AccountSaleStatus,
  AccountStatus,
  AccountView,
  CreateAccountInput,
} from "@/types/account";
import { parseDate, supabase, toIsoDate } from "./supabase";
import { getWarrantyDays } from "./settings";

type AccountRow = {
  id: string;
  email: string;
  chatgpt_account_id: string | null;
  status: "Pending" | "Success" | "Fail" | "Sold";
  sold_at: string | null;
  warranty_days: number | null;
  batch_name: string | null;
  is_plus_verified_real: boolean;
  created_at: string;
  updated_at: string;
};

type SecretRow = {
  email: string;
  password: string | null;
  mail_refresh_token: string | null;
  chatgpt_access_token: string | null;
};

type AccountWithSecret = AccountRow & {
  secret?: SecretRow;
};

const tableName = "accounts";
const secretTableName = "account_secrets";
const ordersTableName = "shop_orders";
const SOURCE_WEB_SHOP = "sell_chatgpt_web";
const EMAIL_IN_FILTER_CHUNK_SIZE = 100;

function mapDbStatus(status: AccountRow["status"]): AccountStatus {
  if (status === "Success" || status === "Sold") return "reg-success";
  if (status === "Fail") return "reg-failed";
  return "not-registered";
}

function mapUiStatus(status: AccountStatus): AccountRow["status"] {
  if (status === "reg-success") return "Success";
  if (status === "reg-failed") return "Fail";
  return "Pending";
}

function saleStatusFor(row: AccountRow): AccountSaleStatus {
  if (row.status === "Sold" || row.sold_at) return "sold";
  if (row.batch_name) return "reserved";
  if (row.status === "Success" && row.is_plus_verified_real) return "available";
  return "reserved";
}

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function mapAccountDocument(row: AccountWithSecret): AccountDocument {
  const secret = row.secret;
  return {
    id: row.id,
    email: row.email,
    accountId: row.chatgpt_account_id ?? "",
    status: mapDbStatus(row.status),
    saleStatus: saleStatusFor(row),
    soldOrderId: row.batch_name ?? undefined,
    soldAt: parseDate(row.sold_at) ?? undefined,
    password: secret?.password ?? undefined,
    sessionToken: secret?.mail_refresh_token ?? undefined,
    mailkp: secret?.chatgpt_access_token ?? undefined,
    passwordMailkp: undefined,
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

function mapAccount(row: AccountWithSecret): AccountView {
  const document = mapAccountDocument(row);
  return {
    id: document.id,
    email: document.email,
    accountId: document.accountId,
    status: document.status,
    saleStatus: document.saleStatus,
    soldOrderId: document.soldOrderId,
    password: document.password,
    sessionToken: document.sessionToken,
    passwordMasked: document.password ? maskSecret(document.password) : "Khong luu",
    tokenMasked: document.sessionToken ? maskSecret(document.sessionToken) : "Khong luu",
    mailkpMasked: document.mailkp ? maskSecret(document.mailkp) : "Khong co",
    passwordMailkpMasked: document.passwordMailkp ? maskSecret(document.passwordMailkp) : "Khong co",
    createdAt: document.createdAt.toLocaleString("vi-VN"),
  };
}

async function attachSecrets(rows: AccountRow[]): Promise<AccountWithSecret[]> {
  if (rows.length === 0) return [];
  const emails = rows.map((row) => row.email);
  const secrets: SecretRow[] = [];

  for (let index = 0; index < emails.length; index += EMAIL_IN_FILTER_CHUNK_SIZE) {
    const emailChunk = emails.slice(index, index + EMAIL_IN_FILTER_CHUNK_SIZE);
    const { data, error } = await supabase
      .from(secretTableName)
      .select("email,password,mail_refresh_token,chatgpt_access_token")
      .in("email", emailChunk);

    if (error) throw error;
    secrets.push(...((data ?? []) as SecretRow[]));
  }

  const secretsByEmail = new Map(
    secrets.map((secret) => [secret.email.toLowerCase(), secret]),
  );
  return rows.map((row) => ({
    ...row,
    secret: secretsByEmail.get(row.email.toLowerCase()),
  }));
}

function collectOrderAccountIds(order: {
  account_id: string | null;
  accounts: unknown;
}) {
  const ids = new Set<string>();
  if (order.account_id) ids.add(order.account_id);
  const accounts = Array.isArray(order.accounts) ? order.accounts : [];
  for (const account of accounts) {
    if (!account || typeof account !== "object") continue;
    const id = "id" in account ? account.id : null;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

async function filterAccountsNotInActiveOrders(rows: AccountRow[]) {
  if (rows.length === 0) return rows;

  const candidateIds = new Set(rows.map((row) => row.id));
  const { data, error } = await supabase
    .from(ordersTableName)
    .select("account_id,accounts")
    .in("status", ["assigned", "completed"]);

  if (error) throw error;

  const lockedAccountIds = new Set<string>();
  for (const order of (data ?? []) as {
    account_id: string | null;
    accounts: unknown;
  }[]) {
    for (const id of collectOrderAccountIds(order)) {
      if (candidateIds.has(id)) lockedAccountIds.add(id);
    }
  }

  return rows.filter((row) => !lockedAccountIds.has(row.id));
}

export async function listAccounts(): Promise<AccountView[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (await attachSecrets((data ?? []) as AccountRow[])).map(mapAccount);
}

export async function countAccounts() {
  const { count, error } = await supabase
    .from(tableName)
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export async function countAccountsByStatus(status: AccountStatus) {
  const { count, error } = await supabase
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("status", mapUiStatus(status));

  if (error) throw error;
  return count ?? 0;
}

export async function findAccountByEmail(email: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("email", email.trim())
    .maybeSingle();

  if (error) throw error;
  const [account] = await attachSecrets(data ? [data as AccountRow] : []);
  return account ? mapAccountDocument(account) : null;
}

export async function getAccountById(id: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  const [account] = await attachSecrets(data ? [data as AccountRow] : []);
  return account ? mapAccountDocument(account) : null;
}

export async function getAccountByOrderId(orderId: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("batch_name", orderId)
    .maybeSingle();

  if (error) throw error;
  const [account] = await attachSecrets(data ? [data as AccountRow] : []);
  return account ? mapAccount(account) : null;
}

export async function listSellableAccounts() {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("status", "Success")
    .eq("is_plus_verified_real", true)
    .is("sold_at", null)
    .is("batch_name", null);

  if (error) throw error;
  const rows = await filterAccountsNotInActiveOrders((data ?? []) as AccountRow[]);
  return (await attachSecrets(rows)).map(mapAccount);
}

export async function countSellableAccounts() {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("status", "Success")
    .eq("is_plus_verified_real", true)
    .is("sold_at", null)
    .is("batch_name", null);

  if (error) throw error;
  return (await filterAccountsNotInActiveOrders((data ?? []) as AccountRow[])).length;
}

export async function countSoldAccounts() {
  const { count, error } = await supabase
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("status", "Sold");

  if (error) throw error;
  return count ?? 0;
}

export type AccountWarrantySummary = {
  id: string;
  soldAt: Date | null;
  warrantyDays: number;
};

export async function getAccountWarrantySummaries(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map<string, AccountWarrantySummary>();
  }

  const { data, error } = await supabase
    .from(tableName)
    .select("id,sold_at,warranty_days")
    .in("id", uniqueIds);

  if (error) throw error;

  return new Map(
    ((data ?? []) as Pick<AccountRow, "id" | "sold_at" | "warranty_days">[]).map((row) => [
      row.id,
      {
        id: row.id,
        soldAt: parseDate(row.sold_at),
        warrantyDays: row.warranty_days ?? 0,
      },
    ]),
  );
}

export async function listAvailableAccountsForSale() {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("status", "Success")
    .eq("is_plus_verified_real", true)
    .is("sold_at", null)
    .is("batch_name", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  const rows = await filterAccountsNotInActiveOrders((data ?? []) as AccountRow[]);
  return (await attachSecrets(rows)).map(mapAccount);
}

export async function findExistingAccounts(inputs: CreateAccountInput[]): Promise<AccountView[]> {
  if (inputs.length === 0) return [];
  const emails = [...new Set(inputs.map((input) => input.email))];
  const rows: AccountRow[] = [];

  for (let index = 0; index < emails.length; index += EMAIL_IN_FILTER_CHUNK_SIZE) {
    const emailChunk = emails.slice(index, index + EMAIL_IN_FILTER_CHUNK_SIZE);
    const { data, error } = await supabase.from(tableName).select("*").in("email", emailChunk);

    if (error) throw error;
    rows.push(...((data ?? []) as AccountRow[]));
  }

  return (await attachSecrets(rows)).map(mapAccount);
}

export async function createAccounts(inputs: CreateAccountInput[]) {
  if (inputs.length === 0) return;
  const now = toIsoDate();
  const { error } = await supabase.from(tableName).upsert(
    inputs.map((input) => ({
      email: input.email,
      chatgpt_account_id: input.accountId,
      status: mapUiStatus(input.status),
      is_plus_verified_real: input.status === "reg-success",
      source: SOURCE_WEB_SHOP,
      created_at: now,
      updated_at: now,
    })),
    { onConflict: "email" },
  );

  if (error) throw error;

  const accounts = await findExistingAccounts(inputs);
  const accountIdByEmail = new Map(accounts.map((account) => [account.email.toLowerCase(), account.id]));
  const { error: secretError } = await supabase.from(secretTableName).upsert(
    inputs.map((input) => ({
      account_id: accountIdByEmail.get(input.email.toLowerCase()) ?? null,
      email: input.email,
      password: input.password ?? null,
      mail_refresh_token: input.sessionToken ?? null,
      chatgpt_access_token: input.mailkp ?? null,
      source: SOURCE_WEB_SHOP,
      created_at: now,
      updated_at: now,
    })),
    { onConflict: "email" },
  );
  if (secretError) throw secretError;
}

export async function updateAccountStatus(id: string, status: AccountStatus) {
  const account = await getAccountById(id);
  if (account?.saleStatus === "sold") {
    throw new Error("Tài khoản đã bán không thể đổi trạng thái reg");
  }

  const { error } = await supabase
    .from(tableName)
    .update({
      status: mapUiStatus(status),
      is_plus_verified_real: status === "reg-success",
      sold_at: null,
      batch_name: null,
      updated_at: toIsoDate(),
    })
    .eq("id", id);

  if (error) throw error;
}

export async function updateAccountSaleStatus(id: string, saleStatus: AccountSaleStatus) {
  const account = await getAccountById(id);
  if (account?.saleStatus === "sold" && saleStatus !== "sold") {
    throw new Error("Tài khoản đã bán chỉ có thể mở lại bằng thao tác thu hồi");
  }

  const warrantyDays = await getWarrantyDays();
  const patch =
    saleStatus === "sold"
      ? {
          status: "Sold",
          sold_at: toIsoDate(),
          batch_name: "manual",
          warranty_days: warrantyDays,
          updated_at: toIsoDate(),
        }
      : {
          status: "Success",
          sold_at: null,
          batch_name: saleStatus === "reserved" ? "manual" : null,
          is_plus_verified_real: true,
          updated_at: toIsoDate(),
        };
  const { error } = await supabase
    .from(tableName)
    .update(patch)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteAccount(id: string) {
  const { error } = await supabase.from(tableName).delete().eq("id", id);
  if (error) throw error;
}

export async function assignAccountToOrder(accountId: string, orderId: string) {
  const { data, error } = await supabase
    .from(tableName)
    .update({
      batch_name: orderId,
      sold_at: null,
      updated_at: toIsoDate(),
    })
    .eq("id", accountId)
    .eq("status", "Success")
    .eq("is_plus_verified_real", true)
    .is("sold_at", null)
    .is("batch_name", null)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function markAccountAsSold(accountId: string, orderId: string) {
  const now = toIsoDate();
  const warrantyDays = await getWarrantyDays();
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "Sold",
      sold_at: now,
      batch_name: orderId,
      warranty_days: warrantyDays,
      updated_at: now,
    })
    .eq("id", accountId)
    .eq("batch_name", orderId)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function releaseAccountFromOrder(accountId: string, orderId: string) {
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "Success",
      batch_name: null,
      sold_at: null,
      updated_at: toIsoDate(),
    })
    .eq("id", accountId)
    .eq("batch_name", orderId)
    .neq("status", "Sold")
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function rollbackAccountOrderAssignment(accountId: string, orderId: string) {
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "Success",
      batch_name: null,
      sold_at: null,
      updated_at: toIsoDate(),
    })
    .eq("id", accountId)
    .eq("batch_name", orderId)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function revokeAccount(accountId: string) {
  const account = await getAccountById(accountId);
  if (!account || account.saleStatus !== "sold") return null;

  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "Success",
      batch_name: null,
      sold_at: null,
      updated_at: toIsoDate(),
    })
    .eq("id", accountId)
    .eq("status", "Sold")
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1 ? account.soldOrderId : null;
}

export async function revokeAccountsByOrderId(orderId: string) {
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "Success",
      batch_name: null,
      sold_at: null,
      updated_at: toIsoDate(),
    })
    .eq("batch_name", orderId)
    .eq("status", "Sold")
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}
