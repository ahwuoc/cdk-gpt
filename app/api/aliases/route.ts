import { redirect } from "next/navigation";
import { accountRepository } from "@/oidc/account-repository";
import { getDefaultAliasDomain } from "@/oidc/alias-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveHumanUserId(request: Request) {
  return request.headers.get("x-demo-human-user-id") ?? process.env.OIDC_DEMO_HUMAN_USER_ID ?? "user_demo_1";
}

function safeReturnTo(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/dashboard";
  if (value.startsWith("//")) return "/dashboard";
  return value;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const humanUserId = resolveHumanUserId(request);
  const aliasCount = Number(formData.get("count") ?? 1);
  const count = Number.isFinite(aliasCount) ? Math.min(Math.max(Math.floor(aliasCount), 1), 20) : 1;

  for (let index = 0; index < count; index += 1) {
    await accountRepository.createAlias({
      humanUserId,
      domain: getDefaultAliasDomain(),
      givenName: "OpenAI",
      familyName: "Alias",
    });
  }

  redirect(returnTo);
}
