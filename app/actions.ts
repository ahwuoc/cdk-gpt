"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAdminUser,
  deductAdminUserBalance,
  findAdminUserByUsername,
  getAdminUserBalance,
  refundAdminUserBalance,
  updateAdminUserBalance,
  updateAdminUserRole,
  deleteAdminUser,
} from "@/lib/admin-users";
import {
  buildLoginRedirectUrl,
  getCurrentSession,
  loginWithCredentials,
  logout,
  requireAdmin,
  setFlashMessage,
} from "@/lib/auth";
import {
  assignAccountToOrder,
  countSellableAccounts,
  createAccounts,
  deleteAccount,
  findExistingAccounts,
  listAvailableAccountsForSale,
  markAccountAsSold,
  releaseAccountFromOrder,
  rollbackAccountOrderAssignment,
  updateAccountStatus,
  updateAccountSaleStatus,
  getAccountById,
  findAccountByEmail,
  revokeAccountsByOrderId,
} from "@/lib/accounts";
import type {
  AccountSaleStatus,
  AccountStatus,
  CreateAccountInput,
} from "@/types/account";
import {
  createOrder,
  getOrderById,
  assignOrderAccounts,
  cancelOrder,
  completeOrder,
  listOrdersByUsername,
  refundOrder,
} from "@/lib/orders";
import { SHOP_PRICE } from "@/lib/config";
import { logTransaction } from "@/lib/transactions";
import { getSetting, getShopPrice, setSetting, setShopPrice, setWarrantyDays } from "@/lib/settings";

function readRequiredField(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Thiếu trường dữ liệu bắt buộc: ${key}`);
  }
  return value.trim();
}

async function redirectWithMessage(type: "success" | "error", message: string) {
  await setFlashMessage(type, message);
  redirect("/admin");
}

async function redirectToLogin(message: string, redirectTo = "/admin") {
  await setFlashMessage("error", message);
  const params = new URLSearchParams({ redirectTo });
  redirect(`/login?${params.toString()}`);
}

async function redirectToRegister(message: string) {
  await setFlashMessage("error", message);
  redirect("/register");
}

async function redirectToShop(message: string) {
  await setFlashMessage("error", message);
  redirect("/shop");
}

async function redirectToDeposit(type: "success" | "error", message: string) {
  await setFlashMessage(type, message);
  redirect("/deposit");
}

async function redirectToOrders(type: "success" | "error", message: string) {
  await setFlashMessage(type, message);
  redirect("/orders");
}

// --- Auth Actions ---

export async function loginAction(formData: FormData) {
  const username = readRequiredField(formData, "username");
  const password = readRequiredField(formData, "password");
  const redirectToValue = formData.get("redirectTo");
  const redirectTo =
    typeof redirectToValue === "string" && redirectToValue.startsWith("/")
      ? redirectToValue
      : "/admin";

  const authenticated = await loginWithCredentials(username, password);

  if (!authenticated) {
    await redirectToLogin("Thông tin đăng nhập không chính xác", redirectTo);
  }

  redirect(redirectTo);
}

export async function registerAction(formData: FormData) {
  const username = readRequiredField(formData, "username").toLowerCase();
  const password = readRequiredField(formData, "password");
  const confirmPassword = readRequiredField(formData, "confirmPassword");

  if (username.length < 3) await redirectToRegister("Username phải có ít nhất 3 ký tự");
  if (password.length < 6) await redirectToRegister("Mật khẩu phải có ít nhất 6 ký tự");
  if (password !== confirmPassword) await redirectToRegister("Mật khẩu nhập lại không khớp");

  const result = await createAdminUser(username, password);
  if (!result.success) await redirectToRegister(result.message);

  const authenticated = await loginWithCredentials(username, password);
  if (!authenticated) await redirectToLogin("Không thể đăng nhập sau khi đăng ký");

  redirect("/shop");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

// --- Shop & Order Actions ---

export async function createOrderAction(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) redirect(buildLoginRedirectUrl("/shop"));

  const quantityStr = formData.get("quantity");
  const parsedQuantity =
    typeof quantityStr === "string" ? Number.parseInt(quantityStr, 10) : Number.NaN;
  const quantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
  
  const shopPrice = await getShopPrice();
  const totalPrice = shopPrice * quantity;

  const currentUser = await findAdminUserByUsername(session.username);
  const currentBalance = getAdminUserBalance(currentUser);
  const maxAffordableQuantity =
    shopPrice > 0 ? Math.floor(currentBalance / shopPrice) : 0;

  if (quantity > maxAffordableQuantity) {
    await redirectToShop(
      maxAffordableQuantity > 0
        ? `Số dư hiện tại chỉ đủ mua tối đa ${maxAffordableQuantity} tài khoản`
        : "Số dư không đủ để thực hiện giao dịch",
    );
  }

  if (currentBalance < totalPrice) {
    await redirectToShop("Số dư không đủ để thực hiện giao dịch");
  }

  const [sellableCount, availableAccounts] = await Promise.all([
    countSellableAccounts(),
    listAvailableAccountsForSale(),
  ]);

  if (sellableCount < quantity || availableAccounts.length < quantity) {
    await redirectToShop(`Hiện tại chỉ còn ${sellableCount} tài khoản trong kho`);
  }

  const deducted = await deductAdminUserBalance(session.username, totalPrice);
  if (!deducted) {
    await redirectToShop("Lỗi khi trừ số dư, vui lòng thử lại");
  }

  await logTransaction({
    username: session.username,
    type: "purchase",
    amount: totalPrice,
    balanceBefore: currentBalance,
    balanceAfter: currentBalance - totalPrice,
    note: `Mua ${quantity} tài khoản ChatGPT`,
  });

  const orderId = await createOrder({
    buyerUsername: session.username,
    buyerContact: "Shop Purchase",
    quantity,
    unitPrice: shopPrice,
  });

  const reservedAccounts: { id: string; email: string }[] = [];

  try {
    for (const account of availableAccounts) {
      if (reservedAccounts.length >= quantity) break;
      const reserved = await assignAccountToOrder(account.id, orderId);
      if (reserved) {
        reservedAccounts.push({ id: account.id, email: account.email });
      }
    }

    if (reservedAccounts.length < quantity) {
      throw new Error("Không đủ tài khoản khả dụng thực tế");
    }

    const assigned = await assignOrderAccounts(orderId, reservedAccounts);
    if (!assigned) {
      throw new Error("Không thể cập nhật thông tin đơn hàng");
    }

    const soldResults = await Promise.all(
      reservedAccounts.map((account) => markAccountAsSold(account.id, orderId)),
    );
    if (soldResults.some((result) => !result)) {
      throw new Error("Không thể chốt trạng thái bán cho toàn bộ tài khoản");
    }

    const completed = await completeOrder(orderId);
    if (!completed) {
      throw new Error("Không thể hoàn tất đơn hàng");
    }

    revalidatePath("/admin");
    revalidatePath("/orders");
    revalidatePath("/shop");
    revalidatePath("/my-orders");
    revalidatePath("/admin/users");
  } catch (error: any) {
    console.error("Purchase error:", error);

    await Promise.allSettled(
      reservedAccounts.map((account) =>
        rollbackAccountOrderAssignment(account.id, orderId),
      ),
    );

    await Promise.allSettled([
      refundAdminUserBalance(session.username, totalPrice),
      cancelOrder(orderId),
    ]);

    await logTransaction({
      username: session.username,
      type: "refund",
      amount: totalPrice,
      balanceBefore: currentBalance - totalPrice,
      balanceAfter: currentBalance,
      note: `Hoàn tiền — ${error.message}`,
    });

    await redirectToShop(`Lỗi xử lý: ${error.message}. Tiền đã được hoàn lại.`);
  }

  redirect("/my-orders");
}

// --- Admin Account Actions ---

export async function bulkImportAccountsAction(formData: FormData) {
  await requireAdmin();
  const payload = readRequiredField(formData, "bulkData");

  const rows = payload
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const seenEmails = new Set<string>();

  const accounts: CreateAccountInput[] = [];

  for (const [index, row] of rows.entries()) {
    const parts = row.split("|").map((part) => part.trim());
    let [email, password, sessionToken, accountId, mailkp, passwordMailkp] = ["", "", "", "", "", ""];

    if (parts.length >= 4) {
      [email, password, sessionToken, accountId, mailkp, passwordMailkp] = parts;
    } else if (parts.length >= 2) {
      [email, accountId] = parts;
    }

    if (!email || !accountId) {
      await redirectWithMessage("error", `Dòng ${index + 1} không hợp lệ (Cần ít nhất Email và ClientID)`);
    }

    if (seenEmails.has(email.toLowerCase())) {
      await redirectWithMessage("error", `Dòng ${index + 1} bị trùng email trong danh sách import`);
    }

    seenEmails.add(email.toLowerCase());

    accounts.push({
      email,
      accountId,
      password,
      sessionToken,
      mailkp,
      passwordMailkp,
      status: "not-registered",
    });
  }

  const existing = await findExistingAccounts(accounts);
  const existingEmails = new Set(existing.map(acc => acc.email.toLowerCase()));

  const newAccounts = accounts.filter(acc => !existingEmails.has(acc.email.toLowerCase()));

  if (newAccounts.length === 0) {
    await redirectWithMessage("error", "Tất cả tài khoản trong danh sách đều đã tồn tại trong hệ thống");
    return;
  }

  await createAccounts(newAccounts);
  revalidatePath("/admin");

  const skippedCount = accounts.length - newAccounts.length;
  const successMessage = skippedCount > 0
    ? `Đã import ${newAccounts.length} tài khoản mới, bỏ qua ${skippedCount} tài khoản bị trùng.`
    : `Đã import thành công ${newAccounts.length} tài khoản.`;

  await redirectWithMessage("success", successMessage);
}

export async function updateAccountStatusAction(formData: FormData) {
  await requireAdmin();
  const id = readRequiredField(formData, "id");
  const status = readRequiredField(formData, "status") as AccountStatus;

  const allowedStatuses: AccountStatus[] = ["reg-success", "reg-failed", "not-registered"];
  if (!allowedStatuses.includes(status)) throw new Error("Trạng thái không hợp lệ");

  await updateAccountStatus(id, status);
  revalidatePath("/admin");
  revalidatePath("/admin/accounts");
  revalidatePath("/orders");
  revalidatePath("/admin/orders");
  revalidatePath("/shop");
  return { success: true, message: "Đã cập nhật trạng thái tài khoản" };
}

export async function updateAccountSaleStatusAction(formData: FormData) {
  await requireAdmin();
  const id = readRequiredField(formData, "id");
  const saleStatus = readRequiredField(formData, "saleStatus") as AccountSaleStatus;

  await updateAccountSaleStatus(id, saleStatus);
  revalidatePath("/admin");
  revalidatePath("/admin/accounts");
  revalidatePath("/shop");
  return { success: true, message: "Đã cập nhật trạng thái đăng bán" };
}

export async function deleteAccountAction(formData: FormData) {
  await requireAdmin();
  const id = readRequiredField(formData, "id");
  await deleteAccount(id);
  revalidatePath("/admin");
  revalidatePath("/admin/accounts");
  revalidatePath("/shop");
  return { success: true, message: "Đã xóa tài khoản khỏi hệ thống" };
}

export async function revokeAccountAction(formData: FormData) {
  await requireAdmin();
  const id = readRequiredField(formData, "id");
  const account = await getAccountById(id);
  const soldOrderId = account?.soldOrderId ?? null;

  if (!soldOrderId) {
    return { success: false, message: "Tài khoản này chưa gắn với đơn hàng đã bán" };
  }

  const order = await getOrderById(soldOrderId);
  const assignedAccounts = order?.accounts ?? [];
  const effectiveCount = assignedAccounts.length || (order?.accountId ? 1 : 0);

  if (!order || effectiveCount === 0) {
    return {
      success: false,
      message: "Không tìm thấy dữ liệu đơn hàng hợp lệ để thu hồi",
    };
  }

  const revokedCount = await revokeAccountsByOrderId(soldOrderId);

  if (revokedCount > 0) {
    // Mark the order as refunded
    await refundOrder(soldOrderId);

    // Automatically refund the user balance
    if (order && order.buyerUsername) {
      const refundAmount = order.totalPrice;
      const buyer = await findAdminUserByUsername(order.buyerUsername);
      const currentBalance = getAdminUserBalance(buyer);
      const newBalance = currentBalance + refundAmount;
      await updateAdminUserBalance(order.buyerUsername, newBalance);

      // Log the refund transaction
      await logTransaction({
        username: order.buyerUsername,
        type: "refund",
        amount: refundAmount,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
        note: `Hoàn tiền tự động do thu hồi ${revokedCount}/${effectiveCount} tài khoản của đơn #${soldOrderId.slice(-8).toUpperCase()}`,
      });
    }

    revalidatePath("/admin");
    revalidatePath("/shop");
    revalidatePath("/orders");
    revalidatePath("/my-orders");
    return {
      success: true,
      message:
        effectiveCount > 1
          ? `Đã thu hồi toàn bộ ${revokedCount} tài khoản của đơn và hoàn tiền thành công`
          : "Đã thu hồi tài khoản và hoàn tiền thành công",
    };
  }
  return { success: false, message: "Không thể thu hồi tài khoản này" };
}

// --- Admin Order Management ---

export async function assignOrderAccountAction(formData: FormData) {
  await requireAdmin();
  const orderId = readRequiredField(formData, "orderId");
  const accountId = readRequiredField(formData, "accountId");

  const availableAccounts = await listAvailableAccountsForSale();
  const selectedAccount = availableAccounts.find((a) => a.id === accountId);

  if (!selectedAccount?.email) {
    await redirectToOrders("error", "Tài khoản không còn khả dụng để gán");
    return;
  }

  const order = await getOrderById(orderId);
  if (!order || order.status !== "pending" || order.accountId || order.quantity !== 1) {
    await redirectToOrders("error", "Đơn hàng không hợp lệ để gán tài khoản");
    return;
  }

  const reserved = await assignAccountToOrder(accountId, orderId);
  if (!reserved) {
    await redirectToOrders("error", "Tài khoản vừa được sử dụng cho đơn hàng khác");
    return;
  }

  const assigned = await assignOrderAccounts(orderId, [{ id: accountId, email: selectedAccount.email }]);
  if (!assigned) {
    await releaseAccountFromOrder(accountId, orderId);
    await redirectToOrders("error", "Không thể cập nhật thông tin đơn hàng");
    return;
  }

  revalidatePath("/admin");
  revalidatePath("/orders");
  await redirectToOrders("success", "Đã gán tài khoản cho đơn hàng thành công");
}

export async function completeOrderAction(formData: FormData) {
  await requireAdmin();
  const orderId = readRequiredField(formData, "orderId");
  const order = await getOrderById(orderId);

  const assignedAccounts = order?.accounts ?? [];
  const accountIds = assignedAccounts.length
    ? assignedAccounts.map((account) => account.id)
    : order?.accountId
      ? [order.accountId]
      : [];

  if (!order || order.status !== "assigned" || accountIds.length === 0) {
    await redirectToOrders("error", "Đơn hàng không ở trạng thái có thể hoàn tất");
    return;
  }

  const soldResults = await Promise.all(
    accountIds.map((accountId) => markAccountAsSold(accountId, orderId)),
  );
  if (soldResults.some((result) => !result)) {
    await redirectToOrders("error", "Không thể chốt toàn bộ tài khoản của đơn hàng");
    return;
  }

  const completed = await completeOrder(orderId);
  if (!completed) {
    await redirectToOrders("error", "Không thể hoàn tất đơn hàng");
    return;
  }

  revalidatePath("/admin");
  revalidatePath("/orders");
  revalidatePath("/shop");
  await redirectToOrders("success", "Đã xác nhận hoàn tất đơn hàng");
}

export async function cancelOrderAction(formData: FormData) {
  await requireAdmin();
  const orderId = readRequiredField(formData, "orderId");
  const order = await getOrderById(orderId);

  if (!order || !["pending", "assigned"].includes(order.status)) {
    await redirectToOrders("error", "Đơn hàng này không thể hủy");
    return;
  }

  if (order.status === "assigned") {
    const assignedAccounts = order.accounts ?? [];
    const accountIds = assignedAccounts.length
      ? assignedAccounts.map((account) => account.id)
      : order.accountId
        ? [order.accountId]
        : [];

    await Promise.allSettled(
      accountIds.map((accountId) => releaseAccountFromOrder(accountId, orderId)),
    );
  }

  await cancelOrder(orderId);
  revalidatePath("/admin");
  revalidatePath("/orders");
  revalidatePath("/shop");
  await redirectToOrders("success", "Đã hủy đơn hàng và hoàn trả kho (nếu có)");
}

// --- Admin User Management ---

export async function updateBalanceAction(formData: FormData) {
  await requireAdmin();
  const username = readRequiredField(formData, "username");
  const amountStr = readRequiredField(formData, "balance");
  const type = formData.get("type") as string || "set";
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount < 0) throw new Error("Số tiền không hợp lệ");

  const user = await findAdminUserByUsername(username);
  if (!user) throw new Error("Người dùng không tồn tại");

  let newBalance = amount;
  let message = `Đã đặt số dư cho ${username} là ${amount}`;
  let txType: "credit" | "debit" | "set" = "set";

  if (type === "add") {
    newBalance = (user.balance || 0) + amount;
    message = `Đã cộng ${amount} vào tài khoản ${username}`;
    txType = "credit";
  } else if (type === "subtract") {
    newBalance = Math.max(0, (user.balance || 0) - amount);
    message = `Đã trừ ${amount} từ tài khoản ${username}`;
    txType = "debit";
  }

  const balanceBefore = user.balance || 0;
  await updateAdminUserBalance(username, newBalance);

  await logTransaction({
    username,
    type: txType,
    amount,
    balanceBefore,
    balanceAfter: newBalance,
    note: message,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  return { success: true, message };
}

export async function updateUserRoleAction(formData: FormData) {
  await requireAdmin();
  const username = readRequiredField(formData, "username");
  const role = readRequiredField(formData, "role");
  if (role !== "admin" && role !== "user") {
    return { success: false, message: "Quyền không hợp lệ, chỉ chấp nhận admin hoặc user" };
  }

  const session = await getCurrentSession();
  if (session?.username === username) {
    return { success: false, message: "Bạn không thể tự thay đổi quyền của chính mình" };
  }

  await updateAdminUserRole(username, role);
  revalidatePath("/admin/users");
  return { success: true, message: `Đã cập nhật quyền thành ${role} cho ${username}` };
}

export async function deleteUserAction(formData: FormData) {
  await requireAdmin();
  const username = readRequiredField(formData, "username");

  const session = await getCurrentSession();
  if (session?.username === username) {
    return { success: false, message: "Bạn không thể tự xóa tài khoản của mình" };
  }

  await deleteAdminUser(username);
  revalidatePath("/admin/users");
  return { success: true, message: `Đã xóa vĩnh viễn người dùng ${username}` };
}

// --- External API Actions ---

export async function getMessagesAction(email: string) {
  const session = await getCurrentSession();
  if (!session) throw new Error("Vui lòng đăng nhập");

  if (session.role !== "admin") {
    const userOrders = await listOrdersByUsername(session.username);
    const hasOrder = userOrders.some((order) => {
      if (order.status !== "completed") {
        return false;
      }
      if (order.accountEmail === email) {
        return true;
      }
      return order.accounts.some((account) => account.email === email);
    });
    if (!hasOrder) {
      throw new Error("Bạn không có quyền truy cập tài khoản này");
    }
  }

  // Fetch credentials from DB
  const account = await findAccountByEmail(email);
  if (!account || !account.password || !account.sessionToken) {
    throw new Error("Không tìm thấy thông tin xác thực cho tài khoản này");
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://tools.dongvanfb.net/api/get_messages_oauth2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: account.email,
        pass: account.password,
        refresh_token: account.sessionToken,
        client_id: account.accountId,
        list_mail: 'all'
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.status === true && data.messages) {
      return {
        success: true,
        messages: data.messages.map((msg: any) => {
          let otp = msg.code || "";
          if (otp === "") {
            const matches = msg.message?.match(/>\s*(\d{6})\s*<\/p>/) || msg.message?.match(/[^#](\d{6})/);
            otp = matches ? (matches[1] || matches[0].trim()) : null;
            if (otp) otp = otp.toString().match(/\d{6}/)?.[0] || null;
          }
          return { ...msg, otp };
        })
      };
    }
    return { success: false, message: data.message || "Không có tin nhắn mới" };
  } catch (error: any) {
    console.error("CheckMail error:", error);
    if (error.name === 'AbortError') {
      return { success: false, message: "Lỗi: API phản hồi quá chậm (Timeout 15s)" };
    }
    return { success: false, message: `Lỗi kết nối: ${error.message}` };
  }
}

export async function updateShopPriceAction(formData: FormData) {
  await requireAdmin();

  const priceStr = formData.get("shopPrice");
  if (typeof priceStr !== "string") {
    throw new Error("Dữ liệu giá không hợp lệ");
  }

  const price = parseInt(priceStr, 10);
  if (isNaN(price) || price < 0) {
    await redirectWithMessage("error", "Giá bán phải là số nguyên dương");
  }

  const success = await setShopPrice(price);
  if (success) {
    revalidatePath("/admin");
    revalidatePath("/shop");
    await redirectWithMessage("success", "Đã cập nhật giá bán tài khoản ChatGPT Plus");
  } else {
    await redirectWithMessage("error", "Lỗi lưu cấu hình giá bán vào cơ sở dữ liệu");
  }
}



export async function updateWarrantyDaysAction(formData: FormData) {
  await requireAdmin();

  const daysStr = formData.get("warrantyDays");
  if (typeof daysStr !== "string") {
    throw new Error("Dữ liệu bảo hành không hợp lệ");
  }

  const days = parseInt(daysStr, 10);
  if (isNaN(days) || days < 0) {
    await redirectWithMessage("error", "Số ngày bảo hành phải là số nguyên không âm");
  }

  const success = await setWarrantyDays(days);
  if (success) {
    revalidatePath("/admin");
    revalidatePath("/my-orders");
    await redirectWithMessage("success", "Đã cập nhật thời gian bảo hành");
  } else {
    await redirectWithMessage("error", "Lỗi lưu cấu hình bảo hành vào cơ sở dữ liệu");
  }
}
