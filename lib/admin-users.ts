import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { AdminUserDocument, AdminUserRole } from "@/types/admin-user";
import { parseDate, supabase, toIsoDate } from "./supabase";

type AdminUserRow = {
  id?: string | null;
  username: string;
  password_hash: string;
  role: AdminUserRole | null;
  balance: number | null;
  created_at: string;
  updated_at: string;
};

const tableName = "shop_admin_users";

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password: string, passwordHash: string) {
  const [salt, expectedHash] = passwordHash.split(":");

  if (!salt || !expectedHash) {
    return false;
  }

  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(derivedKey, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function mapAdminUser(row: AdminUserRow): AdminUserDocument {
  return {
    id: row.id ?? undefined,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role ?? undefined,
    balance: Number(row.balance ?? 0),
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

let cachedHasRegisteredAdminUsers: boolean | null = null;

export async function hasRegisteredAdminUsers() {
  if (cachedHasRegisteredAdminUsers === true) {
    return true;
  }

  const { count, error } = await supabase
    .from(tableName)
    .select("username", { count: "exact", head: true })
    .limit(1);

  if (error) throw error;
  const hasUsers = (count ?? 0) > 0;
  if (hasUsers) {
    cachedHasRegisteredAdminUsers = true;
  }
  return hasUsers;
}

export async function hasAdminUsers() {
  const { count, error } = await supabase
    .from(tableName)
    .select("username", { count: "exact", head: true })
    .or("role.eq.admin,role.is.null")
    .limit(1);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function findAdminUserByUsername(username: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("username", username.trim().toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return data ? mapAdminUser(data as AdminUserRow) : null;
}

export function getAdminUserRole(user: AdminUserDocument | null) {
  if (!user) {
    return null;
  }

  return user.role ?? "admin";
}

export function getAdminUserBalance(user: AdminUserDocument | null) {
  if (!user || typeof user.balance !== "number" || Number.isNaN(user.balance)) {
    return 0;
  }

  return user.balance;
}

export async function createAdminUser(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const existingUser = await findAdminUserByUsername(normalizedUsername);

  if (existingUser) {
    return {
      success: false as const,
      message: "Username da ton tai",
    };
  }

  const isFirstUser = !(await hasRegisteredAdminUsers());
  const now = toIsoDate();
  const { error } = await supabase.from(tableName).insert({
    username: normalizedUsername,
    password_hash: hashPassword(password),
    role: isFirstUser ? "admin" : "user",
    balance: 0,
    created_at: now,
    updated_at: now,
  });

  if (error) throw error;
  cachedHasRegisteredAdminUsers = true;
  return { success: true as const };
}

export async function verifyAdminCredentials(username: string, password: string) {
  const user = await findAdminUserByUsername(username);

  if (!user) {
    return false;
  }

  return verifyPassword(password, user.passwordHash);
}

export async function deductAdminUserBalance(username: string, amount: number) {
  if (amount <= 0) {
    return false;
  }

  const { data, error } = await supabase.rpc("deduct_admin_user_balance", {
    p_username: username.trim().toLowerCase(),
    p_amount: amount,
  });

  if (error) throw error;
  return data === true;
}

export async function refundAdminUserBalance(username: string, amount: number) {
  if (amount <= 0) return false;
  const { data, error } = await supabase.rpc("increment_admin_user_balance", {
    p_username: username.trim().toLowerCase(),
    p_amount: amount,
  });

  if (error) throw error;
  return data === true;
}

export async function listAdminUsers() {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapAdminUser(row as AdminUserRow));
}

export async function updateAdminUserBalance(username: string, balance: number) {
  const { data, error } = await supabase
    .from(tableName)
    .update({ balance, updated_at: toIsoDate() })
    .eq("username", username.trim().toLowerCase())
    .select("username");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function updateAdminUserRole(username: string, role: AdminUserRole) {
  const { data, error } = await supabase
    .from(tableName)
    .update({ role, updated_at: toIsoDate() })
    .eq("username", username.trim().toLowerCase())
    .select("username");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function deleteAdminUser(username: string) {
  const { data, error } = await supabase
    .from(tableName)
    .delete()
    .eq("username", username.trim().toLowerCase())
    .select("username");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}
