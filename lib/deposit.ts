import { createHash } from "node:crypto";
import type { AdminUserDocument } from "@/types/admin-user";

export function buildDepositCode(user: AdminUserDocument, prefix = process.env.BANK_DEPOSIT_PREFIX || "GPT") {
  const userKey = user.id
    ? user.id.replace(/-/g, "").slice(0, 12)
    : createHash("sha256").update(user.username).digest("hex").slice(0, 12);

  return `${prefix}${userKey}`.toUpperCase();
}
