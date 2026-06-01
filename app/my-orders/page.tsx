import { listOrdersByUsername } from "@/lib/orders";
import { getAccountWarrantySummaries } from "@/lib/accounts";
import { getCurrentSession, requireAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/types/order";
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
import Link from "next/link";
import { Package, ChevronLeft, ExternalLink } from "lucide-react";
import { MessagesModal } from "@/components/messages-modal";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const orderStatusLabel: Record<OrderStatus, string> = {
  pending: "Đang chờ",
  assigned: "Đã gán",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
  refunded: "Hoàn tiền",
};

const orderStatusVariant: Record<
  OrderStatus,
  "warning" | "secondary" | "success" | "destructive"
> = {
  pending: "warning",
  assigned: "secondary",
  completed: "success",
  cancelled: "destructive",
  refunded: "secondary",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function getWarrantyLabel(summary?: {
  soldAt: Date | null;
  warrantyDays: number;
}) {
  if (!summary?.soldAt || summary.warrantyDays <= 0) {
    return null;
  }

  const expiresAt = summary.soldAt.getTime() + summary.warrantyDays * DAY_MS;
  const remainingDays = Math.ceil((expiresAt - Date.now()) / DAY_MS);
  if (remainingDays <= 0) {
    return {
      active: false,
      text: "Hết bảo hành",
    };
  }

  return {
    active: true,
    text: `Bảo hành còn ${remainingDays} ngày`,
  };
}

export default async function MyOrdersPage() {
  await requireAuth();
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  const orders = await listOrdersByUsername(session.username);
  const accountIds = orders.flatMap((order) => {
    if (order.accounts.length > 0) return order.accounts.map((account) => account.id);
    return order.accountId ? [order.accountId] : [];
  });
  const warrantyByAccountId = await getAccountWarrantySummaries(accountIds);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f8efe4,transparent_35%),linear-gradient(180deg,#fffdf8_0%,#f5eee3_100%)]">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-6">
        <div className="flex items-center gap-4">
          <Link
            href="/shop"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white shadow-sm transition-colors hover:bg-stone-50"
          >
            <ChevronLeft className="h-5 w-5 text-stone-600" />
          </Link>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-stone-900">Đơn hàng của tôi</h1>
            <p className="text-sm text-stone-500">
              Xem lịch sử mua hàng và thông tin tài khoản ChatGPT đã mua.
            </p>
          </div>
        </div>

        <Card className="overflow-hidden border-stone-200 bg-white/80 shadow-xl backdrop-blur">
          <CardHeader className="border-b border-stone-100 bg-stone-50/50 px-6 py-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <Package className="h-5 w-5 text-amber-600" />
                Lịch sử mua hàng
              </CardTitle>
              <Badge variant="outline" className="bg-white px-3 py-1 font-medium text-stone-600">
                {orders.length} đơn hàng
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-stone-100 flex items-center justify-center">
                  <Package className="h-8 w-8 text-stone-300" />
                </div>
                <div className="space-y-1">
                  <p className="text-stone-900 font-medium">Bạn chưa có đơn hàng nào.</p>
                  <p className="text-sm text-stone-500">Hãy khám phá các gói tài khoản trong cửa hàng.</p>
                </div>
                <Link
                  href="/shop"
                  className="inline-flex h-9 items-center justify-center rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 shadow transition-colors hover:bg-stone-900/90"
                >
                  Đến cửa hàng
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-stone-50/30">
                    <TableRow className="border-stone-100">
                      <TableHead className="px-6 py-4 text-stone-600">Mã đơn</TableHead>
                      <TableHead className="px-6 py-4 text-stone-600">Giá</TableHead>
                      <TableHead className="px-6 py-4 text-stone-600">Trạng thái</TableHead>
                      <TableHead className="px-6 py-4 text-stone-600">Tài khoản</TableHead>
                      <TableHead className="px-6 py-4 text-right text-stone-600">Ngày mua</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} className="border-stone-100 transition-colors hover:bg-stone-50/50">
                        <TableCell className="px-6 py-4">
                          <Link
                            href={`/shop/success?orderId=${order.id}`}
                            className="font-mono text-xs text-stone-500 hover:text-amber-600 hover:underline flex items-center gap-1"
                          >
                            #{order.id.slice(-8).toUpperCase()}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </TableCell>
                        <TableCell className="px-6 py-4 text-sm font-medium text-stone-900">
                          {order.totalPriceLabel}
                          {order.quantity > 1 && (
                            <div className="text-xs font-normal text-stone-400">
                              {order.unitPriceLabel} x {order.quantity}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="px-6 py-4">
                          <Badge variant={orderStatusVariant[order.status] as any} className="font-normal">
                            {orderStatusLabel[order.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-6 py-4">
                          <div className="flex flex-col gap-3">
                            {order.accounts && order.accounts.length > 0 ? (
                              order.accounts.map((acc, idx) => {
                                const warranty = getWarrantyLabel(warrantyByAccountId.get(acc.id));
                                return (
                                  <div key={idx} className="flex flex-wrap items-center gap-2 text-sm text-stone-600 border-b border-stone-50 pb-2 last:border-0 last:pb-0">
                                    <span className="font-medium text-stone-900">{acc.email}</span>
                                    {order.status === 'completed' && (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-emerald-50 text-emerald-700 border-emerald-100">
                                          Sẵn sàng
                                        </Badge>
                                        {warranty && (
                                          <Badge
                                            variant="outline"
                                            className={`text-[10px] uppercase tracking-wider ${
                                              warranty.active
                                                ? "bg-amber-50 text-amber-700 border-amber-100"
                                                : "bg-stone-50 text-stone-500 border-stone-200"
                                            }`}
                                          >
                                            {warranty.text}
                                          </Badge>
                                        )}
                                        <MessagesModal email={acc.email} />
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            ) : order.accountEmail ? (
                              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
                                <span className="font-medium text-stone-900">{order.accountEmail}</span>
                                {order.status === 'completed' && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-emerald-50 text-emerald-700 border-emerald-100">
                                      Sẵn sàng
                                    </Badge>
                                    {(() => {
                                      const warranty = getWarrantyLabel(
                                        order.accountId ? warrantyByAccountId.get(order.accountId) : undefined,
                                      );
                                      return warranty ? (
                                        <Badge
                                          variant="outline"
                                          className={`text-[10px] uppercase tracking-wider ${
                                            warranty.active
                                              ? "bg-amber-50 text-amber-700 border-amber-100"
                                              : "bg-stone-50 text-stone-500 border-stone-200"
                                          }`}
                                        >
                                          {warranty.text}
                                        </Badge>
                                      ) : null;
                                    })()}
                                    <MessagesModal email={order.accountEmail} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-stone-400 italic">Đang chờ xử lý</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-4 text-right text-sm text-stone-500">
                          {order.createdAt}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center mt-4">
          <Link
            href="/shop"
            className="text-sm font-medium text-amber-700 hover:text-amber-600 flex items-center gap-1 transition-colors"
          >
            Tiếp tục mua sắm
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </Link>
        </div>
      </section>
    </main>
  );
}
