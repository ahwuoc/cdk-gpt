import { parseDate, supabase, toIsoDate } from "./supabase";

export type TransactionType = "credit" | "debit" | "purchase" | "refund" | "set";

export interface TransactionDocument {
  id: string;
  username: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string;
  createdAt: Date;
}

export interface TransactionView {
  id: string;
  username: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string;
  createdAt: string;
}

type TransactionRow = {
  id: string;
  username: string;
  type: TransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  note: string;
  created_at: string;
};

const tableName = "shop_transactions";

function mapTransaction(row: TransactionRow): TransactionView {
  return {
    id: row.id,
    username: row.username,
    type: row.type,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    note: row.note,
    createdAt: (parseDate(row.created_at) ?? new Date()).toLocaleString("vi-VN"),
  };
}

export async function logTransaction(input: {
  username: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string;
}) {
  const { error } = await supabase.from(tableName).insert({
    username: input.username,
    type: input.type,
    amount: input.amount,
    balance_before: input.balanceBefore,
    balance_after: input.balanceAfter,
    note: input.note,
    created_at: toIsoDate(),
  });

  if (error) throw error;
}

export async function listTransactions(limit = 50): Promise<TransactionView[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapTransaction(row as TransactionRow));
}

export async function listTransactionsByUsername(username: string, limit = 50): Promise<TransactionView[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("username", username.trim().toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapTransaction(row as TransactionRow));
}
