import Link from "next/link";
import { AlertCircle, History, Package } from "lucide-react";
import { ImportModal } from "@/components/import-modal";
import { MessagesModal } from "@/components/messages-modal";
import { UpdateStatusSelect } from "@/components/update-status-select";
import { UpdateSaleStatusButton } from "@/components/update-sale-status-button";
import { RevokeAccountButton } from "@/components/revoke-account-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminAccountsPage(props: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const searchParams = await props.searchParams;
  await requireAdmin();

  const accounts = await listAccounts();
  const currentTab = searchParams.tab || "all";
  const filteredAccounts = accounts.filter((account) => {
    if (currentTab === "all") return true;
    if (currentTab === "sold") return account.saleStatus === "sold";
    return account.status === currentTab && account.saleStatus !== "sold";
  });

  const tabs = [
    { id: "all", label: "Tất cả", count: accounts.length },
    { id: "not-registered", label: "Chưa reg", count: accounts.filter((account) => account.status === "not-registered").length },
    { id: "reg-success", label: "Thành công", count: accounts.filter((account) => account.status === "reg-success" && account.saleStatus !== "sold").length },
    { id: "reg-failed", label: "Thất bại", count: accounts.filter((account) => account.status === "reg-failed").length },
    { id: "sold", label: "Đã bán", count: accounts.filter((account) => account.saleStatus === "sold").length },
  ];

  return (
    <main>
      <section className="mx-auto flex w-full max-w-[1500px] flex-col gap-7 px-4 py-8 md:px-6 lg:px-8">
        <header className="flex flex-col gap-5 rounded-3xl border border-white bg-white/70 p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <Package className="h-4 w-4" />
              Account Inventory
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Quản lý tài khoản</h1>
            <p className="mt-2 text-sm text-slate-500">Import, reg status, trạng thái bán và thu hồi account.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ImportModal />
          </div>
        </header>

        <Card className="overflow-hidden rounded-3xl border-none bg-white shadow-sm">
          <CardHeader className="flex flex-col gap-4 border-b border-slate-50 px-6 py-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="text-xl font-black text-slate-950">Danh sách account</CardTitle>
              <CardDescription>Đang hiển thị tối đa 100 account theo bộ lọc.</CardDescription>
            </div>
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={`/admin/accounts?tab=${tab.id}`}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${currentTab === tab.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    }`}
                >
                  {tab.label}
                  <span className="rounded-md bg-slate-200/60 px-1.5 py-0.5 text-[10px]">{tab.count}</span>
                </Link>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="border-slate-50">
                    <TableHead className="px-6 py-4 text-slate-600">Thông tin tài khoản</TableHead>
                    <TableHead className="px-6 py-4 text-slate-600">Thao tác reg</TableHead>
                    <TableHead className="px-6 py-4 text-slate-600">Trạng thái bán</TableHead>
                    <TableHead className="px-6 py-4 text-center text-slate-600">Xóa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.slice(0, 100).map((account) => (
                    <TableRow key={account.id} className={`border-slate-50 transition hover:bg-slate-50/30 ${account.status === "not-registered" ? "bg-blue-50/20" : ""}`}>
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{account.email}</span>
                            <MessagesModal email={account.email} />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-tighter text-slate-400">ID: {account.accountId.slice(0, 8)}...</span>
                            {account.status === "not-registered" && <Badge className="border-none bg-blue-100 px-1.5 py-0 text-[10px] text-blue-700 hover:bg-blue-100">CHỜ REG</Badge>}
                            {account.status === "reg-success" && <Badge className="border-none bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-700 hover:bg-emerald-100">ĐÃ REG</Badge>}
                            {account.status === "reg-failed" && <Badge className="border-none bg-red-100 px-1.5 py-0 text-[10px] text-red-700 hover:bg-red-100">LỖI REG</Badge>}
                            {account.status === "reg-success" && (!account.password || !account.sessionToken) && (
                              <span className="flex items-center gap-1 rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
                                <AlertCircle className="h-2.5 w-2.5" /> THIẾU DATA
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <UpdateStatusSelect id={account.id} currentStatus={account.status} email={account.email} />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col gap-2">
                          <Badge
                            variant={account.saleStatus === "sold" ? "outline" : account.saleStatus === "available" && account.status === "reg-success" ? "default" : "secondary"}
                            className={`w-fit font-bold ${account.saleStatus === "available" && account.status === "reg-success" ? "border-none bg-emerald-500 text-white" : ""}`}
                          >
                            {account.saleStatus === "sold"
                              ? "Đã bán"
                              : account.status !== "reg-success"
                                ? "Chờ Reg"
                                : account.saleStatus === "available"
                                  ? "Đang bán"
                                  : "Tạm dừng"}
                          </Badge>

                          {account.saleStatus === "sold" && (
                            <div className="flex flex-col gap-1.5">
                              <RevokeAccountButton id={account.id} email={account.email} />
                              {account.soldOrderId && (
                                <Link href={`/admin/orders?id=${account.soldOrderId}`} className="flex items-center gap-1 text-[10px] text-slate-400 transition hover:text-blue-500">
                                  <History className="h-3 w-3" />
                                  Xem đơn hàng
                                </Link>
                              )}
                            </div>
                          )}

                          {account.saleStatus !== "sold" && account.status === "reg-success" && (
                            <UpdateSaleStatusButton id={account.id} currentSaleStatus={account.saleStatus} email={account.email} />
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
                      <TableCell colSpan={4} className="h-32 text-center font-medium text-slate-400">
                        Không có tài khoản nào trong mục này.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
