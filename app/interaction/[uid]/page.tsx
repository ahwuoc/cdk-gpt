import { accountRepository } from "@/oidc/account-repository";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ uid: string }>;
};

export default async function InteractionPage({ params }: PageProps) {
  const { uid } = await params;
  const humanUserId = process.env.OIDC_DEMO_HUMAN_USER_ID ?? "user_demo_1";
  const aliases = await accountRepository.listAliasesForHumanUser(humanUserId);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Select an account</h1>
          <p className="mt-2 text-sm text-slate-600">
            Choose the email alias OpenAI should receive for this sign-in.
          </p>
        </div>
        <form action="/api/aliases" method="post" className="flex shrink-0 gap-2">
          <input type="hidden" name="returnTo" value={`/interaction/${uid}`} />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Alias
          </button>
        </form>
      </div>
      <form method="post" action={`/interaction/${uid}/finish`} className="mt-6 grid gap-3">
        {aliases.map((alias) => (
          <button
            key={alias.id}
            type="submit"
            name="aliasId"
            value={alias.id}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-500 hover:shadow-md"
          >
            <span className="block font-medium text-slate-950">{alias.email}</span>
            <span className="mt-1 block text-sm text-slate-500">
              {alias.givenName} {alias.familyName}
            </span>
          </button>
        ))}
      </form>
    </main>
  );
}
