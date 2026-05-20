import Link from "next/link";
import {
  logoutAction,
  updateBalanceAction,
  updateAccountSaleStatusAction,
  updateShopPriceAction,
} from "../actions";
import { SubmitButton } from "../submit-button";
import { ImportModal } from "@/components/import-modal";
import { MessagesModal } from "@/components/messages-modal";
import { UpdateStatusSelect } from "@/components/update-status-select";
import { UpdateSaleStatusButton } from "@/components/update-sale-status-button";
import { RevokeAccountButton } from "@/components/revoke-account-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { requireAdmin } from "@/lib/auth";
import { getShopPrice } from "@/lib/settings";
import {
  countSellableAccounts,
  countSoldAccounts,
  listAccounts,
} from "@/lib/accounts";
import { listAdminUsers } from "@/lib/admin-users";
import { listOrders } from "@/lib/orders";
import type { AccountStatus, AccountView } from "@/types/account";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  ExternalLink,
  History,
  LogOut,
  Package,
  ShoppingBag,
  TrendingUp,
  ArrowRight,
  AlertCircle,
  Users,
  Wallet,
  X,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;


function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")} VND`;
}

export default async function AdminPage(props: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const searchParams = await props.searchParams;
  await requireAdmin();

  const [accounts, users, orders, sellableCount, soldCount, shopPrice] = await Promise.all([
    listAccounts(),
    listAdminUsers(),
    listOrders(),
    countSellableAccounts(),
    countSoldAccounts(),
    getShopPrice(),
  ]);

  const currentTab = searchParams.tab || 'all';
  const filteredAccounts = accounts.filter(acc => {
    if (currentTab === 'all') return true;
    if (currentTab === 'sold') return acc.saleStatus === 'sold';
    return acc.status === currentTab && acc.saleStatus !== 'sold';
  });

  const totalUserBalance = users.reduce((sum, user) => sum + (user.balance || 0), 0);
  const totalRevenue = orders.filter(o => o.status === 'completed').reduce((sum, o) => sum + (o.totalPrice || 0), 0);

  const stats = {
    totalAccounts: accounts.length,
    sellable: sellableCount,
    sold: soldCount,
    totalUsers: users.length,
    revenue: totalRevenue,
    totalBalance: totalUserBalance,
  };

  return (
    <main className="min-h-screen bg-[#f8fafc]">
      <section className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-8 md:px-6 lg:px-8">
        <header className="flex flex-col gap-6 rounded-[24px] border border-white bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <Database className="h-4 w-4" />
              Admin Control Panel
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">
              Hệ thống quản trị
            </h1>
            <p className="max-w-2xl text-slate-500">
              Quản lý tài khoản, người dùng và theo dõi doanh thu thời gian thực.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/shop"
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
            >
              <ExternalLink className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              Xem shop
            </Link>
            <Link
              href="/convert"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-5 text-sm font-semibold text-emerald-700 transition-all hover:bg-emerald-100 active:scale-95"
            >
              <ExternalLink className="h-4 w-4" />
              9router Tool
            </Link>
            <Link
              href="/orders"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition-all hover:bg-slate-800 active:scale-95 shadow-lg shadow-slate-200"
            >
              <ShoppingBag className="h-4 w-4" />
              Tất cả đơn hàng
            </Link>
            <ImportModal />
            <form action={logoutAction}>
              <SubmitButton variant="outline" className="h-11 rounded-xl border-red-100 text-red-600 hover:bg-red-50 hover:text-red-700">
                <LogOut className="h-4 w-4" />
              </SubmitButton>
            </form>
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden group">
            <div className="h-1 bg-blue-500 w-full" />
            <CardHeader className="pb-2">
              <CardDescription className="font-medium text-slate-500 flex items-center gap-2">
                <Package className="h-4 w-4" /> Tổng tài khoản
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-slate-900">{stats.totalAccounts}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <div className="text-xs text-slate-400 flex justify-between">
                  <span>{stats.sellable} sẵn sàng</span>
                  <span>{stats.sold} đã bán</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-500" style={{ width: `${(stats.sellable / stats.totalAccounts) * 100}%` }} />
                  <div className="h-full bg-slate-300" style={{ width: `${(stats.sold / stats.totalAccounts) * 100}%` }} />
                </div>
                {accounts.filter(a => a.status === 'not-registered').length > 0 && (
                  <Link href="/admin?tab=not-registered" className="mt-1 flex items-center justify-between rounded-lg bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-600 transition-colors hover:bg-blue-100">
                    <span>{accounts.filter(a => a.status === 'not-registered').length} Cần Reg ngay</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
            <div className="h-1 bg-emerald-500 w-full" />
            <CardHeader className="pb-2">
              <CardDescription className="font-medium text-slate-500 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Doanh thu (Ước tính)
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-emerald-600">{formatPrice(stats.revenue)}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-slate-400">
                Dựa trên {stats.sold} đơn hàng hoàn tất
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
            <div className="h-1 bg-amber-500 w-full" />
            <CardHeader className="pb-2">
              <CardDescription className="font-medium text-slate-500 flex items-center gap-2">
                <Users className="h-4 w-4" /> Người dùng
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-slate-900">{stats.totalUsers}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-slate-400">
                {users.filter(u => u.role === 'admin').length} Admin, {users.filter(u => u.role !== 'admin').length} User
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
            <div className="h-1 bg-purple-500 w-full" />
            <CardHeader className="pb-2">
              <CardDescription className="font-medium text-slate-500 flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Tổng số dư
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-purple-600">{formatPrice(stats.totalBalance)}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-slate-400">
                Tiền của người dùng trong hệ thống
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
          <div className="space-y-8">
            <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden rounded-3xl">
              <CardHeader className="flex flex-col gap-4 border-b border-slate-50 px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-xl font-bold text-slate-900">Quản lý Tài khoản</CardTitle>
                  <CardDescription>Danh sách tài khoản Hotmail/ChatGPT trong kho</CardDescription>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                  {[
                    { id: 'all', label: 'Tất cả', count: accounts.length },
                    { id: 'not-registered', label: 'Chưa reg', count: accounts.filter(a => a.status === 'not-registered').length },
                    { id: 'reg-success', label: 'Thành công', count: accounts.filter(a => a.status === 'reg-success' && a.saleStatus !== 'sold').length },
                    { id: 'reg-failed', label: 'Thất bại', count: accounts.filter(a => a.status === 'reg-failed').length },
                    { id: 'sold', label: 'Đã bán', count: accounts.filter(a => a.saleStatus === 'sold').length }
                  ].map((tab) => (
                    <Link
                      key={tab.id}
                      href={`/admin?tab=${tab.id}`}
                      className={`px-3 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${(!searchParams.tab && tab.id === 'all') || searchParams.tab === tab.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                      {tab.label}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${(!searchParams.tab && tab.id === 'all') || searchParams.tab === tab.id ? 'bg-slate-100' : 'bg-slate-200/50'}`}>
                        {tab.count}
                      </span>
                    </Link>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/50">
                      <TableRow className="border-slate-50">
                        <TableHead className="px-8 py-4 text-slate-600">Thông tin Tài khoản</TableHead>
                        <TableHead className="px-6 py-4 text-slate-600">Thao tác Reg</TableHead>
                        <TableHead className="px-6 py-4 text-slate-600">Trạng thái Bán</TableHead>
                        <TableHead className="px-6 py-4 text-center text-slate-600">Xóa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAccounts.slice(0, 100).map((account) => (
                        <TableRow key={account.id} className={`border-slate-50 hover:bg-slate-50/30 transition-colors ${account.status === 'not-registered' ? 'bg-blue-50/20' : ''}`}>
                          <TableCell className="px-8 py-4">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900">{account.email}</span>
                                <MessagesModal email={account.email} />
                              </div>
                              <div className="flex flex-wrap gap-2 items-center">
                                <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-tighter">ID: {account.accountId.slice(0, 8)}...</span>
                                {account.status === 'not-registered' && (
                                  <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none text-[10px] px-1.5 py-0">CHỜ REG</Badge>
                                )}
                                {account.status === 'reg-success' && (
                                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none text-[10px] px-1.5 py-0">ĐÃ REG</Badge>
                                )}
                                {account.status === 'reg-failed' && (
                                  <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-none text-[10px] px-1.5 py-0">LỖI REG</Badge>
                                )}

                                {account.status === 'reg-success' && (!account.password || !account.sessionToken) && (
                                  <span className="flex items-center gap-1 text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                                    <AlertCircle className="h-2.5 w-2.5" /> THIẾU DATA
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            <UpdateStatusSelect
                              id={account.id}
                              currentStatus={account.status}
                              email={account.email}
                            />
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            <div className="flex flex-col gap-2">
                              <Badge
                                variant={account.saleStatus === 'sold' ? 'outline' : (account.saleStatus === 'available' && account.status === 'reg-success') ? 'default' : 'secondary'}
                                className={`w-fit font-bold ${(account.saleStatus === 'available' && account.status === 'reg-success') ? 'bg-emerald-500 text-white border-none' : ''}`}
                              >
                                {account.saleStatus === 'sold'
                                  ? 'Đã bán'
                                  : account.status !== 'reg-success'
                                    ? 'Chờ Reg'
                                    : account.saleStatus === 'available'
                                      ? 'Đang bán'
                                      : 'Tạm dừng'}
                              </Badge>

                              {account.saleStatus === 'sold' && (
                                <div className="flex flex-col gap-1.5">
                                  <RevokeAccountButton
                                    id={account.id}
                                    email={account.email}
                                  />
                                  {account.soldOrderId && (
                                    <Link
                                      href={`/orders?id=${account.soldOrderId}`}
                                      className="text-[10px] text-slate-400 hover:text-blue-500 transition-colors flex items-center gap-1"
                                    >
                                      <History className="h-3 w-3" />
                                      Xem đơn hàng
                                    </Link>
                                  )}
                                </div>
                              )}

                              {account.saleStatus !== 'sold' && account.status === 'reg-success' && (
                                <UpdateSaleStatusButton
                                  id={account.id}
                                  currentSaleStatus={account.saleStatus}
                                  email={account.email}
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-4 text-center">
                            <DeleteAccountButton id={account.id} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredAccounts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="h-32 text-center text-slate-400 font-medium">
                            Không có tài khoản nào trong mục này.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-8">
            {/* Cấu hình giá bán */}
            <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden rounded-3xl">
              <div className="h-1 bg-amber-500 w-full" />
              <CardHeader className="border-b border-slate-50 px-6 py-5">
                <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-amber-500" /> Cấu hình Giá Bán
                </CardTitle>
                <CardDescription>Cập nhật giá bán tài khoản ChatGPT Plus</CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-5">
                <form action={updateShopPriceAction} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Giá bán hiện tại (MongoDB)</label>
                    <div className="relative">
                      <input
                        type="number"
                        name="shopPrice"
                        defaultValue={shopPrice}
                        required
                        min="0"
                        placeholder="Ví dụ: 10000"
                        className="w-full h-11 px-4 rounded-xl border border-slate-200 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">VND</span>
                    </div>
                  </div>
                  <SubmitButton className="w-full h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl active:scale-95 shadow-md shadow-amber-100">
                    LƯU GIÁ MỚI
                  </SubmitButton>
                </form>
              </CardContent>
            </Card>

            <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden rounded-3xl">
              <CardHeader className="flex flex-row items-center justify-between border-b border-slate-50 px-6 py-5">
                <div>
                  <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-500" /> Quản lý Người dùng
                  </CardTitle>
                  <CardDescription>Chuyển sang trang riêng để quản lý số dư, quyền và tài khoản</CardDescription>
                </div>
                <Link
                  href="/admin/users"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition-all hover:bg-blue-100 active:scale-95"
                >
                  Mở trang user
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6 pt-5">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="text-2xl font-bold text-slate-900">{users.length}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {users.filter((user) => user.role === "admin").length} admin,{" "}
                    {users.filter((user) => user.role !== "admin").length} user thường
                  </div>
                </div>
                <p className="text-sm leading-6 text-slate-500">
                  Tách riêng màn quản lý user để dễ thao tác hơn khi số lượng tài khoản tăng lên.
                </p>
              </CardContent>
            </Card>

            <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden rounded-3xl">
              <CardHeader className="border-b border-slate-50 px-6 py-5">
                <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <History className="h-5 w-5 text-purple-500" /> Đơn hàng gần đây
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <div className="space-y-1">
                  {orders.slice(0, 5).map((order) => (
                    <div key={order.id} className="px-6 py-3 border-b border-slate-50 last:border-0 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-900">#{order.id.slice(-6).toUpperCase()}</span>
                        <span className="text-[10px] text-slate-400">{order.buyerContact}</span>
                      </div>
                      <Badge className="text-[10px] px-1.5 py-0">
                        {order.status}
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-slate-50">
                  <Link href="/orders" className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1">
                    Xem tất cả đơn hàng <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>
    </main >
  );
}
