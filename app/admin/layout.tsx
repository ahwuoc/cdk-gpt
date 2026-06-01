import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/actions";
import { SubmitButton } from "@/app/submit-button";
import { requireAdmin } from "@/lib/auth";
import {
  Database,
  ExternalLink,
  LogOut,
  Package,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: Database },
  { href: "/admin/accounts", label: "Tài khoản", icon: Package },
  { href: "/admin/orders", label: "Đơn hàng", icon: ShoppingBag },
  { href: "/admin/users", label: "Người dùng", icon: Users },
  { href: "/admin/settings", label: "Cấu hình", icon: Settings },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-[#f8fafc] lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 lg:block lg:px-6 lg:py-6">
            <Link href="/admin" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-black text-slate-950">Admin Console</div>
                <div className="text-xs font-medium text-slate-400">Shop management</div>
              </div>
            </Link>
          </div>

          <nav className="flex gap-2 overflow-x-auto px-4 py-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-4 lg:py-5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden border-t border-slate-100 p-4 lg:block">
            <Link
              href="/shop"
              className="mb-3 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <ExternalLink className="h-4 w-4" />
              Xem shop
            </Link>
            <form action={logoutAction}>
              <SubmitButton variant="outline" className="h-11 w-full justify-start rounded-2xl border-red-100 px-4 text-sm font-bold text-red-600 hover:bg-red-50 hover:text-red-700">
                <LogOut className="h-4 w-4" />
                Đăng xuất
              </SubmitButton>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
