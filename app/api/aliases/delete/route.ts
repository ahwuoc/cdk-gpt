import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { hasCompletedTeamOrder } from "@/lib/orders";
import { accountRepository } from "@/oidc/account-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveHumanUserId(request: Request) {
  const session = await getCurrentSession();
  return session?.username ?? request.headers.get("x-demo-human-user-id") ?? process.env.OIDC_DEMO_HUMAN_USER_ID ?? "user_demo_1";
}

function safeReturnTo(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/dashboard";
  if (value.startsWith("//")) return "/dashboard";
  return value;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const aliasId = formData.get("aliasId");
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const session = await getCurrentSession();

  if (!session || !(await hasCompletedTeamOrder(session.username))) {
    redirect(returnTo);
  }

  if (typeof aliasId !== "string") {
    redirect(returnTo);
  }

  const humanUserId = await resolveHumanUserId(request);
  const alias = await accountRepository.getAliasById(aliasId);

  if (alias?.humanUserId === humanUserId) {
    await accountRepository.deleteAlias(alias.id);
  }

  redirect(returnTo);
}
