import { accountRepository } from "@/oidc/account-repository";
import { getOidcProvider } from "@/oidc/provider";
import { runWithNodeBridge } from "@/oidc/next-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ uid: string }>;
};

function resolveHumanUserId(request: Request) {
  return request.headers.get("x-demo-human-user-id") ?? process.env.OIDC_DEMO_HUMAN_USER_ID ?? "user_demo_1";
}

export async function POST(request: Request, _context: RouteContext) {
  const formData = await request.clone().formData();
  const aliasId = formData.get("aliasId");

  if (typeof aliasId !== "string") {
    return new Response("Missing aliasId", { status: 400 });
  }

  const humanUserId = resolveHumanUserId(request);
  const alias = await accountRepository.getAliasById(aliasId);

  if (!alias || alias.humanUserId !== humanUserId) {
    return new Response("Selected account is not available for this user", { status: 400 });
  }

  const provider = getOidcProvider();

  return runWithNodeBridge(request, "/interaction", async (req, res) => {
    const details = await provider.interactionDetails(req, res);
    const clientId = details.params.client_id;

    if (typeof clientId !== "string") {
      throw new Error("Missing OIDC client_id in interaction");
    }

    const grant = new provider.Grant({
      accountId: alias.id,
      clientId,
    });
    grant.addOIDCScope("openid email profile");
    const grantId = await grant.save();

    await provider.interactionFinished(
      req,
      res,
      {
        login: {
          accountId: alias.id,
          remember: true,
          ts: Math.floor(Date.now() / 1000),
          amr: ["account-selection"],
        },
        consent: {
          grantId,
        },
      },
      { mergeWithLastSubmission: false },
    );
  });
}
