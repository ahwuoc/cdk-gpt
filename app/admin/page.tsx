import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { getShopPrice, getWarrantyDays } from "@/lib/settings";
import { countAccounts, countAccountsByStatus, countSellableAccounts, countSoldAccounts } from "@/lib/accounts";
import { listAdminUsers } from "@/lib/admin-users";
import { listOrders } from "@/lib/orders";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight,
  Database,
  History,
  Package,
  Settings,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")} VND`;
}

export default async function AdminPage() {
  await requireAdmin();

  const [
    accountCount,
    users,
    orders,
    sellableCount,
    soldCount,
    shopPrice,
    warrantyDays,
    pendingRegCount,
    failedRegCount,
  ] = await Promise.all([
    countAccounts(),
    listAdminUsers(),
    listOrders(),
    countSellableAccounts(),
    countSoldAccounts(),
    getShopPrice(),
    getWarrantyDays(),
    countAccountsByStatus("not-registered"),
    countAccountsByStatus("reg-failed"),
  ]);

  const totalUserBalance = users.reduce((sum, user) => sum + (user.balance || 0), 0);
  const totalRevenue = orders
    .filter((order) => order.status === "completed")
    .reduce((sum, order) => sum + (order.totalPrice || 0), 0);
  const navItems = [
    {
      href: "/admin/accounts",
      title: "Quản lý tài khoản",
      description: "Import, đổi trạng thái reg, bật/tắt bán và thu hồi account.",
      icon: Package,
      metric: `${accountCount} account`,
      tone: "bg-blue-50 text-blue-700",
    },
    {
      href: "/admin/orders",
      title: "Đơn hàng",
      description: "Theo dõi đơn mua, trạng thái giao hàng và tài khoản đã bàn giao.",
      icon: ShoppingBag,
      metric: `${orders.length} đơn`,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      href: "/admin/users",
      title: "Người dùng",
      description: "Quản lý số dư, quyền admin/user và lịch sử giao dịch.",
      icon: Users,
      metric: `${users.length} user`,
      tone: "bg-amber-50 text-amber-700",
    },
    {
      href: "/admin/settings",
      title: "Cấu hình shop",
      description: "Cập nhật giá bán và số ngày bảo hành mặc định.",
      icon: Settings,
      metric: formatPrice(shopPrice),
      tone: "bg-slate-100 text-slate-700",
    },
  ];

  return (
    <main>
      <section className="mx-auto flex w-full max-w-[1400px] flex-col gap-7 px-4 py-8 md:px-6 lg:px-8">
        <header className="flex flex-col gap-6 rounded-3xl border border-white bg-white/70 p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <Database className="h-4 w-4" />
              Admin Dashboard
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
              Bàn làm việc quản trị
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-500">
              Trang tổng quan chỉ giữ các chỉ số và lối tắt chính. Các tác vụ chi tiết đã được tách sang từng trang riêng.
            </p>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Tài khoản" value={accountCount.toLocaleString("vi-VN")} detail={`${sellableCount} đang bán, ${soldCount} đã bán`} icon={<Package className="h-4 w-4" />} />
          <MetricCard title="Doanh thu" value={formatPrice(totalRevenue)} detail="Từ đơn hàng đã hoàn tất" icon={<TrendingUp className="h-4 w-4" />} />
          <MetricCard title="Người dùng" value={users.length.toLocaleString("vi-VN")} detail={`Tổng số dư ${formatPrice(totalUserBalance)}`} icon={<Users className="h-4 w-4" />} />
          <MetricCard title="Cấu hình" value={formatPrice(shopPrice)} detail={`Bảo hành ${warrantyDays} ngày`} icon={<Wallet className="h-4 w-4" />} />
        </section>

        {(pendingRegCount > 0 || failedRegCount > 0) && (
          <div className="grid gap-3 md:grid-cols-2">
            {pendingRegCount > 0 && (
              <Link href="/admin/accounts?tab=not-registered" className="flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-bold text-blue-700 transition hover:bg-blue-100">
                <span>{pendingRegCount} account đang chờ reg</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            {failedRegCount > 0 && (
              <Link href="/admin/accounts?tab=reg-failed" className="flex items-center justify-between rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-bold text-red-700 transition hover:bg-red-100">
                <span>{failedRegCount} account reg thất bại cần kiểm tra</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}

        <section className="grid gap-5 lg:grid-cols-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="group rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className={`mb-5 flex h-11 w-11 items-center justify-center rounded-2xl ${item.tone}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-500" />
                </div>
                <div className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">{item.metric}</div>
              </Link>
            );
          })}
        </section>

        <Card className="overflow-hidden rounded-3xl border-none bg-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-50 px-6 py-5">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-950">
                <History className="h-5 w-5 text-slate-400" />
                Đơn hàng gần đây
              </CardTitle>
              <CardDescription>5 đơn mới nhất trong hệ thống.</CardDescription>
            </div>
            <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-900">
              Xem tất cả <ArrowRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {orders.slice(0, 5).map((order) => (
              <div key={order.id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-6 py-4 last:border-b-0">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-black text-slate-900">#{order.id.slice(-8).toUpperCase()}</div>
                  <div className="mt-1 truncate text-xs text-slate-400">{order.buyerContact}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-700">{formatPrice(order.totalPrice || 0)}</span>
                  <Badge className="text-[10px] font-bold uppercase">{order.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <Card className="overflow-hidden rounded-3xl border-none bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 font-bold text-slate-500">
          {icon}
          {title}
        </CardDescription>
        <CardTitle className="break-words text-2xl font-black text-slate-950">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs font-medium text-slate-400">{detail}</div>
      </CardContent>
    </Card>
  );
}
