import { Settings, Wallet } from "lucide-react";
import { updateShopPriceAction, updateWarrantyDaysAction } from "@/app/actions";
import { SubmitButton } from "@/app/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { getShopPrice, getWarrantyDays } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [shopPrice, warrantyDays] = await Promise.all([getShopPrice(), getWarrantyDays()]);

  return (
    <main>
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-8 md:px-6">
        <header className="flex flex-col gap-5 rounded-3xl border border-white bg-white/70 p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <Settings className="h-4 w-4" />
              Shop Settings
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Cấu hình shop</h1>
            <p className="mt-2 text-sm text-slate-500">Tách riêng cấu hình để tránh làm rối dashboard chính.</p>
          </div>
        </header>

        <Card className="overflow-hidden rounded-3xl border-none bg-white shadow-sm">
          <div className="h-1 bg-amber-500" />
          <CardHeader className="border-b border-slate-50 px-6 py-5">
            <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-950">
              <Wallet className="h-5 w-5 text-amber-500" />
              Giá bán và bảo hành
            </CardTitle>
            <CardDescription>Các thay đổi sẽ áp dụng cho đơn hàng mới.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 px-6 py-6">
            <form action={updateShopPriceAction} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Giá bán hiện tại</label>
                <div className="relative">
                  <input
                    type="number"
                    name="shopPrice"
                    defaultValue={shopPrice}
                    required
                    min="0"
                    placeholder="Ví dụ: 10000"
                    className="h-12 w-full rounded-xl border border-slate-200 px-4 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">VND</span>
                </div>
              </div>
              <SubmitButton className="h-11 w-full rounded-xl bg-amber-500 font-bold text-slate-950 shadow-md shadow-amber-100 hover:bg-amber-400">
                Lưu giá mới
              </SubmitButton>
            </form>

            <form action={updateWarrantyDaysAction} className="space-y-4 border-t border-slate-100 pt-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Số ngày bảo hành</label>
                <div className="relative">
                  <input
                    type="number"
                    name="warrantyDays"
                    defaultValue={warrantyDays}
                    required
                    min="0"
                    placeholder="Ví dụ: 3"
                    className="h-12 w-full rounded-xl border border-slate-200 px-4 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">NGÀY</span>
                </div>
                <p className="text-xs leading-5 text-slate-400">Áp dụng cho account được bán sau khi lưu cấu hình này.</p>
              </div>
              <SubmitButton className="h-11 w-full rounded-xl bg-slate-900 font-bold text-white shadow-md shadow-slate-100 hover:bg-slate-800">
                Lưu bảo hành
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
