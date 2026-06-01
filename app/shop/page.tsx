import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { countSellableAccounts, countSoldAccounts, listAvailableAccountsForSale } from "@/lib/accounts";
import { getCurrentSession } from "@/lib/auth";
import {
  findAdminUserByUsername,
  getAdminUserBalance,
} from "@/lib/admin-users";
import { getShopPrice } from "@/lib/settings";
import { ShopPurchaseForm } from "@/components/shop-purchase-form";
import { SubmitButton } from "@/app/submit-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRODUCT_IMAGE = "https://taphoammo.com/uploads/products/1772524493_69a693cd3d7e0.webp?v=1776537222";

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")}đ`;
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 3)}***@${domain}`;
}

export default async function ShopPage() {
  const session = await getCurrentSession();
  const [sellableCount, availableAccounts, soldCount, currentUser, price] = await Promise.all([
    countSellableAccounts(),
    listAvailableAccountsForSale(),
    countSoldAccounts(),
    session ? findAdminUserByUsername(session.username) : Promise.resolve(null),
    getShopPrice(),
  ]);
  const currentBalance = getAdminUserBalance(currentUser);
  const safeSoldCount = Math.max(0, soldCount);
  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/shop" className="text-lg font-black text-gray-900">GPT Shop</Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {session ? (
              <>
                <div className="hidden items-center gap-2 rounded-full bg-gray-50 px-3 py-2 text-sm sm:flex">
                  <span className="font-semibold text-gray-700">{session.username}</span>
                  <span className="font-bold text-emerald-600">{formatPrice(currentBalance)}</span>
                </div>
                <Link href="/deposit" className="rounded-full bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700 hover:bg-amber-100">Nạp tiền</Link>
                <Link href="/my-orders" className="rounded-full bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100">Đơn hàng</Link>
                {session.role === "admin" && (
                  <Link href="/admin" className="rounded-full bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800">Admin</Link>
                )}
                <form action={logoutAction}>
                  <SubmitButton
                    variant="outline"
                    className="h-9 rounded-full border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Đăng xuất
                  </SubmitButton>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className="rounded-full bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100">Đăng nhập</Link>
                <Link href="/register" className="rounded-full bg-gray-900 px-3 py-2 text-sm font-bold text-white hover:bg-gray-800">Đăng ký</Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
            <div className="aspect-[16/9] overflow-hidden bg-gray-50">
              <img
                src={PRODUCT_IMAGE}
                alt="ChatGPT Plus"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="space-y-5 p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="mb-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                    Giao hàng tự động
                  </p>
                  <h1 className="text-3xl font-black tracking-tight text-gray-950 md:text-4xl">
                    Tài khoản ChatGPT Plus
                  </h1>
                </div>
                <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${sellableCount > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                  {sellableCount > 0 ? `Còn ${sellableCount} tài khoản` : "Hết hàng"}
                </div>
              </div>

              <p className="max-w-2xl text-base leading-7 text-gray-500">
                Account trạng thái Success, đã xác nhận Plus real. Sau khi thanh toán thành công, hệ thống bàn giao thông tin tài khoản tự động trong mục đơn hàng.
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Đã bán</div>
                  <div className="mt-1 text-2xl font-black text-gray-900">{safeSoldCount}</div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Trong kho</div>
                  <div className="mt-1 text-2xl font-black text-gray-900">{sellableCount}</div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Bàn giao</div>
                  <div className="mt-1 text-2xl font-black text-gray-900">Auto</div>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-24">
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold text-gray-400">Giá mỗi tài khoản</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-4xl font-black tracking-tight text-gray-950">{formatPrice(price)}</span>
                <span className="pb-1 text-sm text-gray-400">/ acc</span>
              </div>

              {session && (
                <div className="mt-5 rounded-2xl bg-gray-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Số dư của bạn</div>
                  <div className="mt-1 text-xl font-black text-emerald-600">{formatPrice(currentBalance)}</div>
                </div>
              )}

              <div className="mt-5">
                {session ? (
                  <ShopPurchaseForm
                    isLoggedIn
                    sellableCount={sellableCount}
                    currentBalance={currentBalance}
                    unitPrice={price}
                  />
                ) : (
                  <Link href="/login" className="flex h-14 w-full items-center justify-center rounded-2xl bg-gray-900 font-bold text-white shadow-xl shadow-gray-200 transition-all hover:bg-gray-800">
                    Đăng nhập để mua
                  </Link>
                )}
              </div>
            </div>

            {session && currentBalance < price && sellableCount > 0 && (
              <Link href="/deposit" className="block rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-800 transition hover:bg-amber-100">
                Số dư chưa đủ. Bấm để nạp tiền.
              </Link>
            )}
          </aside>
        </section>

        <section className="mt-8 rounded-3xl border border-gray-100 bg-gray-50 p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-gray-950">Kho tài khoản sẵn sàng</h2>
              <p className="mt-1 text-sm text-gray-500">Hiển thị mẫu account đang có thể bán ngay.</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-emerald-600">{sellableCount} acc</span>
          </div>
          {availableAccounts.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {availableAccounts.slice(0, 12).map((account) => (
                <div key={account.id} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm shadow-sm">
                  <div className="truncate font-bold text-gray-800">{maskEmail(account.email)}</div>
                  <div className="mt-1 text-xs font-semibold text-emerald-600">Success / Plus real</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-white p-5 text-sm font-medium text-gray-500">Chưa có account Success + Plus real còn hàng.</p>
          )}
          {availableAccounts.length > 12 && (
            <p className="mt-4 text-xs text-gray-400">Đang hiển thị 12/{availableAccounts.length} account đầu tiên.</p>
          )}
        </section>
      </div>
    </div>
  );
}
