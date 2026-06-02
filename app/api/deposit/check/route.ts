import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { findAdminUserByUsername, getAdminUserBalance, updateAdminUserBalance } from "@/lib/admin-users";
import { fetchCakeTransactions, normalizeDepositCode } from "@/lib/bank-api";
import { buildDepositCode } from "@/lib/deposit";
import { getSetting, setSetting } from "@/lib/settings";
import { logTransaction } from "@/lib/transactions";

// Per-user lock to prevent race conditions where two concurrent requests
// (auto-check polling + manual button click, or overlapping auto-checks)
// both find the same unprocessed bank transaction and credit it twice.
const userLocks = new Map<string, Promise<void>>();

function withUserLock<T>(username: string, fn: () => Promise<T>): Promise<T> {
  const previous = userLocks.get(username) ?? Promise.resolve();
  const current = previous.then(fn, fn); // run fn after previous settles (success or failure)
  // Store the void version so the chain continues
  userLocks.set(username, current.then(() => {}, () => {}));
  // Clean up when idle to avoid memory leak
  current.finally(() => {
    if (userLocks.get(username) === current.then(() => {}, () => {})) {
      userLocks.delete(username);
    }
  });
  return current;
}

export async function POST() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Chưa đăng nhập" }, { status: 401 });
  }

  // Wrap the entire deposit logic in a per-user lock
  return withUserLock(session.username, async () => {
    const user = await findAdminUserByUsername(session.username);
    if (!user) {
      return NextResponse.json({ success: false, message: "Không tìm thấy tài khoản người dùng" }, { status: 404 });
    }

    const depositCode = buildDepositCode(user);
    const normalizedCode = normalizeDepositCode(depositCode);
    // Re-read processedIds inside the lock so we always see the latest state
    const processedIds = await getSetting<string[]>("bank_processed_transactions", []);
    const processedSet = new Set(processedIds);
    const transactions = await fetchCakeTransactions();
    const matches = transactions.filter((transaction) => {
      if (processedSet.has(transaction.id)) return false;
      return normalizeDepositCode(transaction.description).includes(normalizedCode);
    });
    const eligibleMatches = matches.filter((transaction) => transaction.amount >= 10000);

    if (eligibleMatches.length === 0) {
      return NextResponse.json({
        success: true,
        credited: false,
        message: matches.length > 0
          ? "Giao dịch nạp tối thiểu là 10.000đ"
          : `Chưa tìm thấy giao dịch mới với nội dung ${depositCode}`,
      });
    }

    const totalAmount = eligibleMatches.reduce((sum, transaction) => sum + transaction.amount, 0);
    const balanceBefore = getAdminUserBalance(user);
    const balanceAfter = balanceBefore + totalAmount;
    const updated = await updateAdminUserBalance(session.username, balanceAfter);

    if (!updated) {
      return NextResponse.json({ success: false, message: "Không thể cập nhật số dư" }, { status: 500 });
    }

    // Mark transactions as processed BEFORE responding, to close race window
    await setSetting("bank_processed_transactions", [
      ...processedIds,
      ...eligibleMatches.map((item) => item.id),
    ].slice(-1000));

    await logTransaction({
      username: session.username,
      type: "credit",
      amount: totalAmount,
      balanceBefore,
      balanceAfter,
      note: `Nạp tiền bank: ${eligibleMatches.map((item) => item.id).join(", ")}`,
    });

    return NextResponse.json({
      success: true,
      credited: true,
      amount: totalAmount,
      balanceAfter,
      message: `Đã cộng ${totalAmount.toLocaleString("vi-VN")}đ vào số dư`,
    });
  });
}
