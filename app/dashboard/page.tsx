import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Mail, Plus, ShieldCheck, Trash2, UserCircle } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import { accountRepository } from "@/oidc/account-repository";
import { getDiscoveryMetadata } from "@/oidc/discovery";
import { hasCompletedTeamOrder } from "@/lib/orders";
import { formatAliasLimit, TEAM_ALIAS_LIMIT } from "@/lib/team-alias";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/");
  }

  const metadata = getDiscoveryMetadata();
  const hasTeamAccess = await hasCompletedTeamOrder(session.username);
  const humanUserId = session.username;
  const aliases = await accountRepository.listAliasesForHumanUser(humanUserId);
  const cookieStore = await cookies();
  const selectedAliasId = cookieStore.get("oidc_selected_alias_id")?.value;
  const aliasLimitLabel = formatAliasLimit();
  const activeAliases = aliases.slice(0, TEAM_ALIAS_LIMIT);
  const overflowAliasCount = Math.max(0, aliases.length - TEAM_ALIAS_LIMIT);

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8 text-slate-950">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-emerald-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-normal text-slate-950">OIDC Dashboard</h1>
              <p className="mt-1 text-sm text-slate-500">Signed in as {session.username}</p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            SSO Home
          </Link>
        </header>

        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Discovery
            </div>
            <div className="mt-3 break-all rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-sm font-semibold text-slate-900">
              {metadata.issuer}/.well-known/openid-configuration
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Issuer</div>
            <div className="mt-3 break-all font-mono text-sm font-semibold text-slate-950">{metadata.issuer}</div>
            <div className="mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">Client</div>
            <div className="mt-2 font-mono text-sm font-semibold text-slate-950">
              {process.env.OIDC_CLIENT_ID ?? "openai-alias-demo"}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {!hasTeamAccess ? (
            <div className="mb-5 rounded-lg border border-amber-100 bg-amber-50 p-4">
              <div className="font-bold text-amber-900">Chưa có gói ChatGPT Team</div>
              <p className="mt-1 text-sm text-amber-800">
                Mua gói ChatGPT Team 50k để quản trị tối đa {aliasLimitLabel} alias riêng.
              </p>
              <Link
                href="/shop"
                className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-amber-600 px-3 text-sm font-bold text-white transition hover:bg-amber-700"
              >
                Mua gói Team
              </Link>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">OpenAI account aliases</h2>
              <p className="mt-1 text-sm text-slate-500">These identities are available in the interaction picker.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form action="/api/aliases" method="post">
                <input type="hidden" name="returnTo" value="/dashboard" />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-700"
                  disabled={!hasTeamAccess || aliases.length >= TEAM_ALIAS_LIMIT}
                >
                  <Plus className="h-4 w-4" />
                  Alias
                </button>
              </form>
              <form action="/api/aliases" method="post">
                <input type="hidden" name="returnTo" value="/dashboard" />
                <input type="hidden" name="count" value="5" />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  disabled={!hasTeamAccess || aliases.length >= TEAM_ALIAS_LIMIT}
                >
                  <Plus className="h-4 w-4" />
                  5
                </button>
              </form>
              <form action="/api/aliases" method="post">
                <input type="hidden" name="returnTo" value="/dashboard" />
                <input type="hidden" name="count" value="20" />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  disabled={!hasTeamAccess || aliases.length >= TEAM_ALIAS_LIMIT}
                >
                  <Plus className="h-4 w-4" />
                  20
                </button>
              </form>
              <div className={`text-xs font-bold uppercase tracking-wider ${overflowAliasCount > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                {activeAliases.length.toLocaleString("vi-VN")}/{aliasLimitLabel} aliases
              </div>
            </div>
          </div>

          {overflowAliasCount > 0 && (
            <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              Account này đang có dư {overflowAliasCount.toLocaleString("vi-VN")} alias so với giới hạn mới. Hệ thống chỉ dùng {aliasLimitLabel} alias cũ nhất cho SSO.
            </div>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {activeAliases.map((alias) => (
              <div key={alias.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-emerald-700 shadow-sm">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="break-all font-mono text-sm font-black text-slate-950">{alias.email}</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                      <UserCircle className="h-4 w-4" />
                      {alias.givenName} {alias.familyName}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-xs text-slate-400">{alias.id}</span>
                      {alias.id === selectedAliasId && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                          Đang chọn
                        </span>
                      )}
                    </div>
                    <form action="/api/aliases/delete" method="post" className="mt-2">
                      <input type="hidden" name="aliasId" value={alias.id} />
                      <input type="hidden" name="returnTo" value="/dashboard" />
                      <button
                        type="submit"
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-100 bg-white px-3 text-xs font-bold text-red-600 transition hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Xóa
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
