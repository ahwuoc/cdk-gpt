import { accountRepository } from "@/oidc/account-repository";
import { getCurrentSession } from "@/lib/auth";
import { hasCompletedTeamOrder } from "@/lib/orders";
import { TEAM_ALIAS_LIMIT } from "@/lib/team-alias";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LockKeyhole, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ uid: string }>;
};

export default async function InteractionPage({ params }: PageProps) {
  const { uid } = await params;
  const session = await getCurrentSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/interaction/${uid}`)}`);
  }

  const hasTeamAccess = session ? await hasCompletedTeamOrder(session.username) : false;
  const humanUserId = session.username;
  const aliases = await accountRepository.listAliasesForHumanUser(humanUserId);
  const activeAliases = aliases.slice(0, TEAM_ALIAS_LIMIT);
  const cookieStore = await cookies();
  const selectedAliasId = cookieStore.get("oidc_selected_alias_id")?.value;
  const selectedAlias = activeAliases.find((alias) => alias.id === selectedAliasId) ?? activeAliases[0];

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl shadow-slate-200/70">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <div className="mt-6 text-center">
          <h1 className="text-2xl font-black tracking-tight">Chọn tài khoản đăng nhập</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Chọn alias OpenAI sẽ nhận cho phiên đăng nhập này.
          </p>
        </div>

        {!hasTeamAccess ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              Tài khoản {session.username} chưa có gói ChatGPT Team nên chưa thể chọn alias riêng.
            </div>
            <a
              href="/shop?product=team"
              className="flex h-12 w-full items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white transition hover:bg-emerald-700"
            >
              Mua gói Team
            </a>
          </div>
        ) : activeAliases.length > 0 ? (
          <form method="post" action={`/interaction/${uid}/finish`} className="mt-6 space-y-3">
            {activeAliases.map((alias) => (
              <label
                key={alias.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-emerald-300 hover:bg-emerald-50/40 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50"
              >
                <input
                  type="radio"
                  name="aliasId"
                  value={alias.id}
                  defaultChecked={alias.id === selectedAlias?.id}
                  className="h-5 w-5 accent-emerald-600"
                />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm font-black text-slate-900">{alias.email}</span>
                  <span className="mt-1 block text-xs font-medium text-slate-500">
                    {alias.givenName} {alias.familyName}
                  </span>
                </span>
              </label>
            ))}

            <button
              type="submit"
              className="mt-4 flex h-12 w-full items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white transition hover:bg-emerald-700 active:scale-[0.99]"
            >
              Tiếp tục
            </button>
          </form>
        ) : (
          <div className="mt-6 rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            Chưa có alias nào cho tài khoản này.
          </div>
        )}

        {hasTeamAccess && (
          <form action="/api/aliases" method="post" className="mt-4">
            <input type="hidden" name="returnTo" value={`/interaction/${uid}`} />
            <button
              type="submit"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <Plus className="h-4 w-4" />
              Tạo alias mới
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-xs font-medium text-slate-400">
          Secured by OIDC-SSO · Authorization Code flow
        </div>
      </section>
    </main>
  );
}
