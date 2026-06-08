import { accountRepository } from "@/oidc/account-repository";
import { getOidcProvider } from "@/oidc/provider";
import { runWithNodeBridge } from "@/oidc/next-bridge";
import { getCurrentSession } from "@/lib/auth";
import { hasCompletedTeamOrder } from "@/lib/orders";
import { TEAM_ALIAS_LIMIT } from "@/lib/team-alias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ uid: string }>;
};

async function resolveHumanUserId(request: Request) {
  const session = await getCurrentSession();
  const hasTeamAccess = session ? await hasCompletedTeamOrder(session.username) : false;
  if (!session || !hasTeamAccess) return null;
  return session.username;
}

export async function GET(request: Request, context: RouteContext) {
  const { uid } = await context.params;
  return Response.redirect(new URL(`/interaction/${uid}`, request.url), 303);
}

export async function POST(request: Request, _context: RouteContext) {
  const formData = await request.clone().formData();
  const aliasId = formData.get("aliasId");

  if (typeof aliasId !== "string") {
    return new Response("Missing aliasId", { status: 400 });
  }

  const humanUserId = await resolveHumanUserId(request);
  if (!humanUserId) {
    return Response.redirect(new URL("/login", request.url), 303);
  }

  const selectedAlias = await accountRepository.getAliasById(aliasId);
  const activeAliases = (await accountRepository.listAliasesForHumanUser(humanUserId)).slice(0, TEAM_ALIAS_LIMIT);
  const alias =
    selectedAlias &&
    selectedAlias.humanUserId === humanUserId &&
    activeAliases.some((activeAlias) => activeAlias.id === selectedAlias.id)
      ? selectedAlias
      : null;

  if (!alias) {
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
          remember: false,
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
