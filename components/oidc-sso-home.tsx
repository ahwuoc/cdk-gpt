import Link from "next/link";
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, Server, ShieldCheck } from "lucide-react";
import { getDiscoveryMetadata } from "@/oidc/discovery";

export function OidcSsoHome() {
  const metadata = getDiscoveryMetadata();

  const endpoints = [
    ["Authorize", metadata.authorization_endpoint],
    ["Token", metadata.token_endpoint],
    ["Userinfo", metadata.userinfo_endpoint],
    ["JWKS", metadata.jwks_uri],
  ];

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-10 text-slate-950">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-center gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-600 text-lg font-black text-white shadow-sm">
            SSO
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black tracking-normal text-slate-950 sm:text-4xl">OIDC-SSO</h1>
            <p className="break-all font-mono text-sm text-slate-500">{metadata.issuer} · OpenID Connect · RS256</p>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-4xl gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-950">OpenAI SSO Provider</h2>
                <p className="text-sm text-slate-500">Authorization Code Flow for account aliases.</p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <Server className="h-4 w-4" />
                Discovery URL
              </div>
              <div className="mt-2 break-all font-mono text-sm font-semibold text-slate-900">
                {metadata.issuer}/.well-known/openid-configuration
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {endpoints.map(([label, url]) => (
                <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {label}
                  </div>
                  <div className="mt-2 break-all font-mono text-xs leading-5 text-slate-500">{url}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex h-full flex-col justify-between gap-5">
              <div className="space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Account Dashboard</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Sign in to inspect the aliases this IdP can present during OpenAI SSO.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <Link
                  href="/auth/nodeloc"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700"
                >
                  <KeyRound className="h-4 w-4" />
                  Sign in
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <p className="mx-auto max-w-xl text-center text-xs leading-5 text-slate-500">
          Configure OpenAI with the discovery URL above. The shop remains available at{" "}
          <Link href="/shop" className="font-semibold text-slate-800 hover:text-emerald-700">
            /shop
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
