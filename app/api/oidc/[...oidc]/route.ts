import { getOidcProvider } from "@/oidc/provider";
import { runWithNodeBridge } from "@/oidc/next-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleOidc(request: Request) {
  const provider = getOidcProvider();
  return runWithNodeBridge(request, "/api/oidc", async (req, res) => {
    await provider.callback()(req, res);
  });
}

export const GET = handleOidc;
export const POST = handleOidc;
