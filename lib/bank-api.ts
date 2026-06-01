const DEFAULT_BANK_API_BASE_URL = "https://thueapibank.vn/historyapicakev2";

export type BankTransaction = {
  id: string;
  amount: number;
  description: string;
  type: string;
  occurredAt?: string;
  raw: unknown;
};

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function readAmount(record: Record<string, unknown>) {
  for (const key of [
    "amount",
    "creditAmount",
    "credit",
    "money",
    "transactionAmount",
    "gia_tri",
    "sotien",
  ]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value === "string") {
      const parsed = Number.parseInt(value.replace(/[^\d-]/g, ""), 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  }
  return 0;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "transactions", "history", "result", "list"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractRows(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function normalizeDepositCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function fetchCakeTransactions() {
  const token = process.env.BANK_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Chưa cấu hình BANK_API_TOKEN");
  }
  const baseUrl = process.env.BANK_API_BASE_URL?.trim() || DEFAULT_BANK_API_BASE_URL;

  const response = await fetch(`${baseUrl}/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`API ngân hàng trả dữ liệu không hợp lệ: ${text.slice(0, 120)}`);
  }

  if (!response.ok) {
    const msg =
      payload && typeof payload === "object" && "msg" in payload
        ? String((payload as Record<string, unknown>).msg)
        : response.statusText;
    throw new Error(`API ngân hàng lỗi ${response.status}: ${msg}`);
  }

  return extractRows(payload)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((record, index): BankTransaction => {
      const id =
        readString(record, [
          "transactionID",
          "transactionId",
          "transId",
          "refNo",
          "reference",
          "id",
          "tid",
        ]) || `row-${index}`;
      return {
        id,
        amount: readAmount(record),
        description: readString(record, [
          "description",
          "content",
          "remark",
          "memo",
          "note",
          "transactionContent",
        ]),
        type: readString(record, ["type", "transactionType", "direction"]),
        occurredAt: readString(record, ["transactionDate", "date", "time", "created_at"]),
        raw: record,
      };
    })
    .filter((transaction) => {
      if (transaction.amount <= 0) return false;
      const type = transaction.type.toUpperCase();
      return !type || type === "IN" || type === "CREDIT" || type === "CR";
    });
}
