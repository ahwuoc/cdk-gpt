import type { OrderDocument, OrderStatus, OrderView } from "@/types/order";
import { getShopPrice } from "./settings";
import { parseDate, supabase, toIsoDate } from "./supabase";

type OrderRow = {
  id: string;
  buyer_username: string | null;
  buyer_contact: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  status: OrderStatus;
  account_id: string | null;
  account_email: string | null;
  accounts: { id: string; email: string }[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

const tableName = "shop_orders";

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function mapOrderDocument(row: OrderRow): OrderDocument {
  return {
    id: row.id,
    buyerUsername: row.buyer_username ?? undefined,
    buyerContact: row.buyer_contact,
    unitPrice: Number(row.unit_price),
    quantity: row.quantity,
    totalPrice: Number(row.total_price),
    status: row.status,
    accountId: row.account_id ?? undefined,
    accountEmail: row.account_email ?? undefined,
    accounts: row.accounts ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
    assignedAt: parseDate(row.assigned_at) ?? undefined,
    completedAt: parseDate(row.completed_at) ?? undefined,
    cancelledAt: parseDate(row.cancelled_at) ?? undefined,
  };
}

function mapOrder(row: OrderRow): OrderView {
  const document = mapOrderDocument(row);
  return {
    id: document.id,
    buyerUsername: document.buyerUsername ?? null,
    buyerContact: document.buyerContact,
    unitPriceLabel: formatPrice(document.unitPrice),
    quantity: document.quantity,
    totalPrice: document.totalPrice,
    totalPriceLabel: formatPrice(document.totalPrice),
    status: document.status,
    accountEmail: document.accountEmail ?? null,
    accountId: document.accountId ?? null,
    accounts: document.accounts ?? [],
    createdAt: document.createdAt.toLocaleString("vi-VN"),
    assignedAt: document.assignedAt
      ? document.assignedAt.toLocaleString("vi-VN")
      : null,
  };
}

export async function createOrder(input: {
  buyerUsername: string;
  buyerContact: string;
  quantity?: number;
  unitPrice?: number;
}) {
  const now = toIsoDate();
  const quantity = input.quantity ?? 1;

  let resolvedPrice = input.unitPrice;
  if (resolvedPrice === undefined) {
    resolvedPrice = await getShopPrice();
  }
  const totalPrice = resolvedPrice * quantity;

  const { data, error } = await supabase
    .from(tableName)
    .insert({
      buyer_username: input.buyerUsername,
      buyer_contact: input.buyerContact.trim(),
      unit_price: resolvedPrice,
      quantity,
      total_price: totalPrice,
      status: "pending",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function listOrders() {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapOrder(row as OrderRow));
}

export async function listOrdersByUsername(username: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("buyer_username", username)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapOrder(row as OrderRow));
}

export async function getOrderById(id: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapOrderDocument(data as OrderRow) : null;
}

export async function assignOrderAccounts(
  orderId: string,
  accounts: { id: string; email: string }[],
) {
  const now = toIsoDate();
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "assigned",
      accounts,
      account_id: accounts[0]?.id ?? null,
      account_email: accounts[0]?.email ?? null,
      assigned_at: now,
      updated_at: now,
    })
    .eq("id", orderId)
    .eq("status", "pending")
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function cancelOrder(orderId: string) {
  const now = toIsoDate();
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "cancelled",
      cancelled_at: now,
      updated_at: now,
    })
    .eq("id", orderId)
    .in("status", ["pending", "assigned"])
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function completeOrder(orderId: string) {
  const now = toIsoDate();
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "completed",
      completed_at: now,
      updated_at: now,
    })
    .eq("id", orderId)
    .eq("status", "assigned")
    .not("account_id", "is", null)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function countOrdersByStatus(status: OrderStatus) {
  const { count, error } = await supabase
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (error) throw error;
  return count ?? 0;
}

export async function refundOrder(orderId: string) {
  const { data, error } = await supabase
    .from(tableName)
    .update({
      status: "refunded",
      account_id: null,
      account_email: null,
      accounts: null,
      assigned_at: null,
      completed_at: null,
      updated_at: toIsoDate(),
    })
    .eq("id", orderId)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export type RecentPurchase = {
  id: string;
  buyerUsername: string | null;
  quantity: number;
  totalPrice: number;
  status: OrderStatus;
  createdAt: Date;
};

export async function getRecentPurchases(limit = 10): Promise<RecentPurchase[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select("id, buyer_username, quantity, total_price, status, created_at")
    .in("status", ["assigned", "completed"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    buyerUsername: row.buyer_username ?? null,
    quantity: row.quantity,
    totalPrice: Number(row.total_price),
    status: row.status as OrderStatus,
    createdAt: parseDate(row.created_at) ?? new Date(),
  }));
}

