import { accountRepository } from "@/oidc/account-repository";

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
      <h1 className="text-2xl font-semibold text-slate-950">Select an account</h1>
      <p className="mt-2 text-sm text-slate-600">
        Choose the email alias OpenAI should receive for this sign-in.
      </p>
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
