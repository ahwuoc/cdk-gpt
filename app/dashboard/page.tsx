import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck, UserCircle } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import { accountRepository } from "@/oidc/account-repository";
import { getDiscoveryMetadata } from "@/oidc/discovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/");
  }

  const metadata = getDiscoveryMetadata();
  const humanUserId = process.env.OIDC_DEMO_HUMAN_USER_ID ?? "user_demo_1";
  const aliases = await accountRepository.listAliasesForHumanUser(humanUserId);

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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">OpenAI account aliases</h2>
              <p className="mt-1 text-sm text-slate-500">These identities are available in the interaction picker.</p>
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              {aliases.length} aliases
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {aliases.map((alias) => (
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
                    <div className="mt-2 break-all font-mono text-xs text-slate-400">{alias.id}</div>
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
